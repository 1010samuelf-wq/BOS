"""The in-app assistant: answers questions about the shop, and proposes changes.

The safety model, in one line: **the model can read, and it can ask; only a
person can write.**

- Read tools run here, immediately, through the same service functions the REST
  API uses, scoped to the signed-in employee's permissions.
- Write tools are never executed by the model loop. They end the turn and come
  back as *proposals* — plural, because a real request is often several changes
  ("merge these three duplicates"), and forcing one round trip each made the
  assistant useless for exactly the tidying it is best at. Batching does not
  weaken the guarantee: nothing runs until a person approves, and each item is
  spelled out separately so approving a batch is not approving a black box.
- The confirmation sentence for every item is built by `describe()` from the
  validated arguments — not by the model — so what is approved is what runs.
- `execute()` runs a confirmed proposal through the ordinary service layer with
  the caller's own permissions re-checked, so the assistant can never do
  anything the person could not already do by clicking through the UI.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.errors import APIError
from app.core.permissions import effective_sections
from app.core.realtime import broadcaster
from app.models import (
    AssistantConversation,
    AssistantMessage,
    Company,
    Customer,
    Expense,
    Order,
    Product,
    Task,
    User,
)
from app.models.base import utc_today, utcnow
from app.models.enums import (
    CompanyType,
    FulfillmentType,
    LedgerEntryType,
    NoteType,
    OrderStatus,
    PaymentMethod,
    PaymentTiming,
)
from app.schemas.task import TaskCreate
from app.services import assistant_tools
from app.services import bookkeeping as bookkeeping_service
from app.services import customer as customer_service
from app.services import order as order_service
from app.services import tasks as task_service
from app.services import trash as trash_service

logger = logging.getLogger("bos.assistant")

# Bounded so a confused model cannot loop forever on one request. Six leaves
# room for a genuine multi-step answer (list -> read one -> report) with slack.
MAX_STEPS = 6

SYSTEM_PROMPT = """\
You are the assistant inside Just Cake's bakery operations system. You help the \
staff who run the shop — taking orders, baking, deliveries, and the books.

You are talking to {name}, whose role is {role}.

How to work:

- Answer from the tools, never from memory. If a question is about orders, \
money, hours, deliveries or the bake list, call a tool and answer from what it \
returns. Do not guess a number.
- Give the answer first, in one or two sentences, then any supporting detail. \
Write plainly, the way you would tell a colleague across the counter.
- Markdown renders, so use it where it genuinely helps: **bold** for a figure \
worth catching the eye, bullet lists, and tables. Reach for a table whenever \
you are showing several rows that share the same columns — a list of orders, a \
bake list, hours per person — because that is far easier to scan than a \
paragraph. Keep tables to about four columns; the panel is narrow. A one-line \
answer stays a plain sentence: never wrap a single figure in a table or put a \
heading above two lines of text.
- Money is in dollars. Reports are cash-basis: only paid orders and paid-out \
shifts count, so an unpaid order contributes nothing to revenue. Say so if it \
matters to the answer.
- If a question is ambiguous in a way that changes the answer — which week, \
whose hours, pickup or delivery — ask rather than guessing. Otherwise make the \
reasonable call and say what you assumed.
- If the tools show nothing, say so plainly. Never invent an order, a customer, \
or a figure.

Making changes:

- You cannot change anything yourself. When a change is wanted, call the \
matching tool; that shows {name} exactly what you propose and they either \
confirm it or not. Do not claim anything has been done.
- When one request covers several things — three orders needing a date, a \
handful of duplicates to merge — call the tool once for each of them in \
the same reply. They are shown as one list and confirmed together, so \
splitting them across turns only makes {name} ask over and over. Propose \
only what was actually asked for.
- If you need to look something up first, do that, then propose the whole \
set once you know the ids. Never propose a change against an id you guessed.
- Never propose cancelling or deleting anything unless the person asked for it \
in that turn.

This is a live shop. Wrong information here sends real bread to the wrong \
address, so being accurate matters more than being fast or thorough.\
"""


def _client():
    """Build the Anthropic client, or fail loudly if the key is unset."""
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise APIError(
            503,
            "assistant_unavailable",
            "The assistant is not configured on this server.",
        )
    import anthropic  # imported lazily so the API boots without the package

    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def is_enabled() -> bool:
    return bool(get_settings().anthropic_api_key)


def _system_blocks(user: User) -> list[dict]:
    """Stable prompt first (cached), volatile facts after the breakpoint.

    Caching is a prefix match, so anything that changes per request has to come
    *after* the cache_control block or it invalidates the cache on every call.
    Today's date is exactly that kind of value.
    """
    return [
        {
            "type": "text",
            "text": SYSTEM_PROMPT.format(name=user.name, role=user.role.value),
            "cache_control": {"type": "ephemeral"},
        },
        {
            "type": "text",
            "text": (
                f"Today is {utc_today().isoformat()}. "
                "Interpret 'today', 'tomorrow' and 'this week' against that date."
            ),
        },
    ]


# ---------------------------------------------------------------------------
# describing a proposal — deterministic, never model-written
# ---------------------------------------------------------------------------
def _order_or_404(db: Session, order_id: Any) -> Order:
    try:
        oid = int(order_id)
    except (TypeError, ValueError):
        raise APIError(400, "bad_action", "That order number isn't valid.")
    order = db.get(Order, oid)
    if order is None:
        raise APIError(404, "not_found", f"Order {oid} was not found.")
    return order


def _company_or_404(db: Session, company_id: Any) -> Company:
    try:
        cid = int(company_id)
    except (TypeError, ValueError):
        raise APIError(400, "bad_action", "That company number isn't valid.")
    company = db.get(Company, cid)
    if company is None:
        raise APIError(404, "not_found", f"Company {cid} was not found.")
    return company


def _positive_amount(raw: Any) -> Decimal:
    """Money off the wire, quantized to cents.

    Goes through Decimal(str(...)) rather than Decimal(float): the model sends
    JSON numbers, and Decimal(284.60) is 284.600000000000022737367544323205947
    which then rounds into the ledger as a figure nobody typed.
    """
    try:
        amount = Decimal(str(raw)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        raise APIError(400, "bad_action", f"{raw!r} is not an amount I can read.") from None
    if amount <= 0:
        raise APIError(400, "bad_action", "An amount has to be more than zero.")
    return amount


def _entry_date(raw: Any) -> date:
    """A ledger date, defaulting to today when none was given."""
    text = str(raw or "").strip()
    if not text:
        return utc_today()
    try:
        return date.fromisoformat(text)
    except ValueError:
        raise APIError(
            400, "bad_action",
            f"I couldn't read {text!r} as a date — it needs to be like 2026-09-05.",
        ) from None


def _needed_date(raw: Any) -> datetime:
    """Read a needed-for date from the model, verbatim.

    This column is a wall-clock business value, not an instant (see CLAUDE.md):
    the text is parsed as written and never timezone-converted, because
    converting makes a date-only order render a day early in production while
    looking correct on the naive SQLite dev DB.
    """
    text = str(raw or "").strip()
    if not text:
        raise APIError(400, "bad_action", "No date was given for that order.")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        raise APIError(
            400, "bad_action",
            f"I couldn't read {text!r} as a date — it needs to be like 2026-09-05.",
        ) from None


def _format_needed(value: datetime) -> str:
    """Render a needed-for date for the confirmation sentence.

    Built by hand rather than with strftime's %-d/%-I, which aren't portable to
    Windows and would break the suite on the dev machine. Reads the datetime's
    own components, so it stays wall-clock like everything else here.
    """
    base = f"{value.day} {value.strftime('%b %Y')}"
    if value.hour or value.minute:
        hour = value.hour % 12 or 12
        ampm = "AM" if value.hour < 12 else "PM"
        return f"{base} at {hour}:{value.minute:02d} {ampm}"
    return base


def describe(db: Session, action: str, args: dict) -> str:
    """The sentence the person actually approves.

    Built from the validated arguments rather than from anything the model
    wrote, so the confirmation cannot describe one action while another runs.
    """
    if action == "mark_order_paid":
        o = _order_or_404(db, args.get("order_id"))
        method = args.get("payment_method")
        how = f" by {method}" if method else ""
        return f"Mark order #{o.id} ({o.client_name}, ${o.total}) as paid{how}."
    if action == "fulfill_order":
        o = _order_or_404(db, args.get("order_id"))
        return f"Mark order #{o.id} ({o.client_name}) as fulfilled."
    if action == "set_order_status":
        o = _order_or_404(db, args.get("order_id"))
        status = str(args.get("status", "")).strip()
        if status not in {"pending", "in_progress", "ready"}:
            raise APIError(400, "bad_action", "That is not a status an order can be set to.")
        label = "in progress" if status == "in_progress" else status
        return f"Set order #{o.id} ({o.client_name}) to {label}."
    if action == "cancel_order":
        o = _order_or_404(db, args.get("order_id"))
        back = "and return the items to stock" if args.get("return_stock", True) else "and leave stock as is"
        return f"Cancel order #{o.id} ({o.client_name}, ${o.total}) {back}."
    if action == "add_order_note":
        o = _order_or_404(db, args.get("order_id"))
        text = str(args.get("text", "")).strip()
        if not text:
            raise APIError(400, "bad_action", "The note is empty.")
        return f'Add a note to order #{o.id} ({o.client_name}): "{text}"'
    if action == "create_task":
        title = str(args.get("title", "")).strip()
        if not title:
            raise APIError(400, "bad_action", "The task has no title.")
        who = db.get(User, args.get("assigned_to"))
        if who is None:
            raise APIError(404, "not_found", "That employee was not found.")
        due = args.get("due_date")
        when = f", due {due}" if due else ""
        return f'Assign "{title}" to {who.name}{when}.'
    if action == "mark_task_done":
        task = db.get(Task, args.get("task_id"))
        if task is None:
            raise APIError(404, "not_found", "That task was not found.")
        verb = "Tick off" if args.get("done", True) else "Reopen"
        return f'{verb} task #{task.id}: "{task.title}".'
    if action == "create_order":
        return _describe_new_order(db, args)
    if action == "create_expense":
        amount = _amount(args.get("amount"))
        desc = str(args.get("description", "")).strip()
        if not desc:
            raise APIError(400, "bad_action", "The expense has no description.")
        when = args.get("spent_on") or utc_today().isoformat()
        cat = f", category {args['category']}" if args.get("category") else ""
        return f'Record an expense of ${amount} on {when}: "{desc}"{cat}.'
    if action == "delete_expense":
        exp = db.get(Expense, args.get("expense_id"))
        if exp is None:
            raise APIError(404, "not_found", "That expense was not found.")
        return (
            f'Permanently delete the expense "{exp.description}" '
            f"of ${exp.amount} on {exp.spent_on}. This cannot be undone."
        )
    if action == "delete_order":
        o = _order_or_404(db, args.get("order_id"))
        # The service refuses a non-cancelled order anyway; checking here means
        # the person is never shown a proposal that was going to fail.
        if o.status != OrderStatus.cancelled:
            raise APIError(
                400,
                "not_cancelled",
                f"Order #{o.id} is not cancelled, so it cannot be deleted. "
                "Cancel it first if that is what you want.",
            )
        return (
            f"Permanently delete cancelled order #{o.id} ({o.client_name}, "
            f"${o.total}). This cannot be undone."
        )
    if action == "merge_customers":
        keep = _customer_or_404(db, args.get("keep_id"))
        dupe = _customer_or_404(db, args.get("duplicate_id"))
        if keep.id == dupe.id:
            raise APIError(400, "bad_action", "Those are the same customer.")
        moved, _value = customer_service.totals(db, dupe.id)
        orders = len(customer_service.history(db, dupe.id))
        return (
            f'Merge "{dupe.name}" into "{keep.name}". '
            f"{orders} order(s) move across and \"{dupe.name}\" is removed. "
            "This cannot be undone."
        )
    if action == "rename_customer":
        customer = _customer_or_404(db, args.get("customer_id"))
        name = " ".join(str(args.get("name", "")).split())
        if not name:
            raise APIError(400, "bad_action", "The new name is empty.")
        return f'Rename customer "{customer.name}" to "{name}". Past orders keep the name typed on them.'
    if action == "create_company":
        name = " ".join(str(args.get("name", "")).split())
        if not name:
            raise APIError(400, "bad_action", "The company needs a name.")
        kind = str(args.get("type", ""))
        if kind not in {"payable", "receivable"}:
            raise APIError(400, "bad_action", "A company is either payable or receivable.")
        which = "a supplier the shop owes" if kind == "payable" else "someone who owes the shop"
        return f'Add "{name}" to the books as {which}.'
    if action == "add_ledger_entry":
        company = _company_or_404(db, args.get("company_id"))
        kind = str(args.get("type", ""))
        if kind not in {"charge", "payment"}:
            raise APIError(400, "bad_action", "That is either a charge or a payment.")
        amount = _positive_amount(args.get("amount"))
        when = _entry_date(args.get("entry_date"))
        note = " ".join(str(args.get("note", "")).split())
        # Spell out which way the balance moves: "charge" and "payment" read
        # the same to someone glancing at a confirmation box.
        after = company.balance + (amount if kind == "charge" else -amount)
        direction = "adds to" if kind == "charge" else "comes off"
        return (
            f"Record a {kind} of ${amount} against {company.name} on "
            f"{_format_needed(datetime(when.year, when.month, when.day))}"
            + (f' — "{note}"' if note else "")
            + f". That {direction} what is owed: ${company.balance} becomes ${after}."
        )
    if action == "set_order_date":
        o = _order_or_404(db, args.get("order_id"))
        when = _needed_date(args.get("needed_for_date"))
        was = _format_needed(o.needed_for_date) if o.needed_for_date else "no date"
        return (
            f"Set order #{o.id} ({o.client_name}) to be needed "
            f"{_format_needed(when)} — currently {was}."
        )
    if action == "set_order_for_whom":
        o = _order_or_404(db, args.get("order_id"))
        text = " ".join(str(args.get("for_whom", "")).split())
        if not text:
            return f"Clear who order #{o.id} ({o.client_name}) was for."
        return f'Record order #{o.id} ({o.client_name}) as being for "{text}".'
    raise APIError(400, "bad_action", "That is not an action the assistant can take.")


def _customer_or_404(db: Session, customer_id: Any) -> Customer:
    try:
        cid = int(customer_id)
    except (TypeError, ValueError):
        raise APIError(400, "bad_action", "That customer number isn't valid.")
    customer = db.get(Customer, cid)
    if customer is None:
        raise APIError(404, "not_found", f"Customer {cid} was not found.")
    return customer


def _amount(value: Any) -> Decimal:
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError):
        raise APIError(400, "bad_action", "That amount isn't a valid number.")
    if amount < 0:
        raise APIError(400, "bad_action", "An amount cannot be negative.")
    return amount


def _order_lines(db: Session, args: dict) -> tuple[list[tuple[str, int, Decimal]], Decimal]:
    """Resolve the proposed items to (name, qty, unit price) and a total.

    Every line is priced from the catalog here, not from anything the model
    said, so the total on the confirmation is the total that will be charged.
    """
    items = args.get("items") or []
    if not isinstance(items, list) or not items:
        raise APIError(400, "bad_action", "The order has no items.")

    lines: list[tuple[str, int, Decimal]] = []
    total = Decimal("0.00")
    for raw in items:
        if not isinstance(raw, dict):
            raise APIError(400, "bad_action", "That order line isn't valid.")
        try:
            qty = int(raw.get("quantity"))
        except (TypeError, ValueError):
            raise APIError(400, "bad_action", "An order line has no quantity.")
        if qty <= 0:
            raise APIError(400, "bad_action", "An order line has a quantity of zero.")

        if raw.get("product_id") is not None:
            product = db.get(Product, raw["product_id"])
            if product is None:
                raise APIError(404, "not_found", "One of those products was not found.")
            name, price = product.name, Decimal(str(product.price))
        else:
            name = str(raw.get("custom_name", "")).strip()
            if not name:
                raise APIError(400, "bad_action", "An order line has no product.")
            price = _amount(raw.get("custom_price"))

        lines.append((name, qty, price))
        total += price * qty

    total += _amount(args.get("delivery_price") or 0)
    return lines, total.quantize(Decimal("0.01"))


def _describe_new_order(db: Session, args: dict) -> str:
    client = str(args.get("client_name", "")).strip()
    if not client:
        raise APIError(400, "bad_action", "The order has no customer name.")

    fulfillment = str(args.get("fulfillment_type", "")).strip()
    if fulfillment not in {"pickup", "delivery"}:
        raise APIError(400, "bad_action", "The order must be a pickup or a delivery.")
    address = str(args.get("delivery_address", "") or "").strip()
    if fulfillment == "delivery" and not address:
        raise APIError(400, "bad_action", "A delivery needs an address.")

    timing = str(args.get("payment_timing", "")).strip()
    if timing not in {"now", "later"}:
        raise APIError(400, "bad_action", "The order needs a payment timing.")
    method = args.get("payment_method")
    if timing == "now" and not method:
        raise APIError(400, "bad_action", "Paying now needs a payment method.")
    if timing == "later" and method:
        raise APIError(400, "bad_action", "A pay-later order must not have a payment method.")

    lines, total = _order_lines(db, args)
    body = "; ".join(f"{qty} x {name} at ${price}" for name, qty, price in lines)
    needed = args.get("needed_for_date") or "no date given"
    where = f"delivery to {address}" if fulfillment == "delivery" else "pickup"
    pay = f"paying now by {method}" if timing == "now" else "paying later"
    return (
        f"Create an order for {client} — {body}. "
        f"Total ${total}. Needed {needed}. {where.capitalize()}, {pay}."
    )


# ---------------------------------------------------------------------------
# executing a confirmed proposal
# ---------------------------------------------------------------------------
def execute(db: Session, user: User, action: str, args: dict) -> str:
    """Run a confirmed proposal through the ordinary service layer.

    Permissions are re-checked here, against the caller — the proposal arrives
    from the browser and is not trusted. The result is that the assistant can
    only ever do what this person could already do through the UI.
    """
    tool = assistant_tools.REGISTRY.get(action)
    if tool is None or not tool.writes:
        raise APIError(400, "bad_action", "That is not an action the assistant can take.")

    sections = effective_sections(user)
    allowed = {t.name for t in assistant_tools.tools_for(user, sections)}
    if action not in allowed:
        raise APIError(403, "forbidden", "You do not have access to that action.")

    # describe() re-validates every argument; call it before touching anything.
    summary = describe(db, action, args)

    if action == "mark_order_paid":
        method = args.get("payment_method")
        order_service.mark_paid(
            db,
            int(args["order_id"]),
            user,
            PaymentMethod(method) if method else None,
        )
    elif action == "fulfill_order":
        order_service.fulfill_order(db, int(args["order_id"]), user)
    elif action == "set_order_status":
        from app.schemas.order import OrderUpdate

        order_service.update_order(
            db,
            int(args["order_id"]),
            OrderUpdate(status=OrderStatus(args["status"])),
            user,
        )
    elif action == "cancel_order":
        order_service.cancel_order(
            db, int(args["order_id"]), bool(args.get("return_stock", True)), user
        )
    elif action == "add_order_note":
        order_service.add_note(
            db, int(args["order_id"]), str(args["text"]).strip(), NoteType.general, user
        )
    elif action == "create_task":
        due = args.get("due_date")
        task_service.create_task(
            db,
            TaskCreate(
                title=str(args["title"]).strip(),
                assigned_to=int(args["assigned_to"]),
                due_date=datetime.fromisoformat(due).replace(tzinfo=timezone.utc)
                if due
                else None,
            ),
            user,
        )
    elif action == "mark_task_done":
        task_service.set_done(db, int(args["task_id"]), user, bool(args.get("done", True)))
    elif action == "create_order":
        order_service.create_order(db, _build_order_payload(args), user)
    elif action == "create_expense":
        db.add(Expense(
            description=str(args["description"]).strip(),
            amount=_amount(args["amount"]),
            category=args.get("category"),
            spent_on=date.fromisoformat(args["spent_on"]) if args.get("spent_on") else utc_today(),
            logged_by=user.id,
        ))
    elif action == "delete_expense":
        expense = db.get(Expense, int(args["expense_id"]))
        if expense is None:
            raise APIError(404, "not_found", "That expense was not found.")
        trash_service.record(
            db,
            kind="expense",
            label=f"{expense.description} — ${expense.amount} on {expense.spent_on.isoformat()}",
            payload=trash_service.snapshot(
                expense, ["description", "amount", "category", "spent_on", "logged_by"]
            ),
            user=user,
        )
        db.delete(expense)
    elif action == "delete_order":
        order_service.delete_order(db, int(args["order_id"]), user=user)
    elif action == "merge_customers":
        customer_service.merge(db, int(args["duplicate_id"]), int(args["keep_id"]))
    elif action == "rename_customer":
        customer_service.update(
            db, int(args["customer_id"]), {"name": " ".join(str(args["name"]).split())}
        )
    elif action == "create_company":
        from app.schemas.bookkeeping import CompanyCreate

        bookkeeping_service.create_company(db, CompanyCreate(
            name=" ".join(str(args["name"]).split()),
            type=CompanyType(args["type"]),
        ))
    elif action == "add_ledger_entry":
        from app.schemas.bookkeeping import LedgerEntryCreate

        note = " ".join(str(args.get("note", "")).split())
        bookkeeping_service.add_entry(
            db,
            int(args["company_id"]),
            LedgerEntryCreate(
                entry_date=_entry_date(args.get("entry_date")),
                type=LedgerEntryType(args["type"]),
                amount=_positive_amount(args.get("amount")),
                note=note or None,
            ),
            user.id,
        )
    elif action == "set_order_date":
        from app.schemas.order import OrderUpdate

        order_service.update_order(
            db,
            int(args["order_id"]),
            OrderUpdate(needed_for_date=_needed_date(args.get("needed_for_date"))),
            user,
        )
    elif action == "set_order_for_whom":
        from app.schemas.order import OrderUpdate

        order_service.update_order(
            db,
            int(args["order_id"]),
            OrderUpdate(for_whom=" ".join(str(args.get("for_whom", "")).split()) or None),
            user,
        )
    else:  # pragma: no cover - guarded by the registry check above
        raise APIError(400, "bad_action", "That is not an action the assistant can take.")

    db.commit()

    # Mirror what the REST routes broadcast, so other open screens and tablets
    # refresh instead of quietly showing stale data.
    if action in {"create_order", "delete_order", "cancel_order"}:
        broadcaster.publish({"type": "orders_changed"})
        broadcaster.publish({"type": "stock_changed"})
    elif action in {"mark_order_paid", "fulfill_order", "set_order_status", "add_order_note"}:
        broadcaster.publish({"type": "orders_changed"})
    logger.info(
        "assistant_action",
        extra={"assistant_action": action, "assistant_actor": user.name},
    )
    return summary


def _build_order_payload(args: dict):
    """Turn a confirmed proposal into a validated OrderCreate.

    The idempotency key is minted here rather than taken from the model: it
    exists to make a retried submit safe, and a value the model chose could
    collide with a real order or be repeated across two different ones.
    """
    from app.schemas.order import OrderCreate, OrderItemIn

    items = []
    for raw in args["items"]:
        items.append(OrderItemIn(
            product_id=raw.get("product_id"),
            custom_name=raw.get("custom_name"),
            custom_price=_amount(raw["custom_price"]) if raw.get("custom_price") is not None else None,
            quantity=int(raw["quantity"]),
        ))

    needed = args.get("needed_for_date")
    method = args.get("payment_method")
    return OrderCreate(
        idempotency_key=f"assistant-{uuid.uuid4().hex}",
        client_name=str(args["client_name"]).strip(),
        client_phone=args.get("client_phone"),
        needed_for_date=datetime.fromisoformat(needed) if needed else None,
        fulfillment_type=FulfillmentType(args["fulfillment_type"]),
        delivery_address=args.get("delivery_address"),
        delivery_name=args.get("delivery_name"),
        card_message=args.get("card_message"),
        payment_timing=PaymentTiming(args["payment_timing"]),
        payment_method=PaymentMethod(method) if method else None,
        items=items,
    )


# ---------------------------------------------------------------------------
# stored conversations
# ---------------------------------------------------------------------------
MAX_HISTORY_TURNS = 40


def _title_from(message: str) -> str:
    """A scannable label for the history list.

    Taken from the opening question rather than asked of the model, which would
    cost an extra call per conversation for something nobody reads closely.
    """
    text = " ".join(message.split())
    return (text[:77] + "...") if len(text) > 80 else text or "New chat"


def own_conversation(db: Session, user: User, conversation_id: int) -> AssistantConversation:
    """Load a conversation, refusing anyone else's.

    A missing row and someone else's row are both reported as not-found: an
    employee has no business learning that a colleague's conversation exists.
    """
    convo = db.get(AssistantConversation, conversation_id)
    if convo is None or convo.user_id != user.id:
        raise APIError(404, "not_found", "That conversation was not found.")
    return convo


def list_conversations(db: Session, user: User, limit: int = 50):
    return (
        db.query(AssistantConversation)
        .filter(AssistantConversation.user_id == user.id)
        .order_by(AssistantConversation.updated_at.desc())
        .limit(limit)
        .all()
    )


def delete_conversation(db: Session, user: User, conversation_id: int) -> None:
    db.delete(own_conversation(db, user, conversation_id))
    db.commit()


# ---------------------------------------------------------------------------
# the conversation loop
# ---------------------------------------------------------------------------
def _text_of(response) -> str:
    return "\n".join(b.text for b in response.content if b.type == "text").strip()


def _upstream_error(exc: Exception) -> APIError:
    """Turn a model-provider failure into something a staff member can act on.

    Without this the SDK's exception escapes as a bare 500 "unexpected error",
    which tells whoever is on shift nothing about whether to retry, wait, or
    fetch the owner.
    """
    import anthropic

    if isinstance(exc, anthropic.AuthenticationError):
        logger.error("assistant_bad_key")
        return APIError(503, "assistant_unavailable",
                        "The assistant's API key is missing or invalid.")
    if isinstance(exc, anthropic.RateLimitError):
        return APIError(429, "assistant_busy",
                        "The assistant is rate limited right now. Try again shortly.")
    if isinstance(exc, (anthropic.APIConnectionError, anthropic.APIStatusError)):
        logger.warning("assistant_upstream_error", extra={"assistant_error": str(exc)[:200]})
        return APIError(502, "assistant_unavailable",
                        "The assistant is temporarily unreachable. Try again shortly.")
    logger.exception("assistant_failed")
    return APIError(502, "assistant_unavailable", "The assistant could not answer that.")


def chat(
    db: Session,
    user: User,
    message: str,
    conversation_id: int | None = None,
    *,
    client=None,
) -> dict:
    """Run one turn against a stored conversation.

    History is read from the database, not from the request, so the browser
    cannot rewrite what was said earlier. Tool calls are re-run from scratch
    each turn rather than replayed, which means every answer is computed
    against current data and a stale lookup can never be smuggled back in.

    Returns {"conversation_id", "title", "reply", "proposals"}.
    """
    settings = get_settings()
    client = client or _client()

    text = message.strip()
    if not text:
        raise APIError(400, "empty", "There is no message to answer.")

    if conversation_id is None:
        convo = AssistantConversation(
            user_id=user.id,
            title=_title_from(text),
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        db.add(convo)
        db.flush()
    else:
        convo = own_conversation(db, user, conversation_id)

    # Record the question before calling out, so it is not lost if the model
    # call fails partway.
    db.add(AssistantMessage(
        conversation_id=convo.id, role="user", text=text, created_at=utcnow()
    ))
    convo.updated_at = utcnow()
    db.commit()

    sections = effective_sections(user)
    tools = assistant_tools.tools_for(user, sections)
    by_name = {t.name: t for t in tools}

    stored = (
        db.query(AssistantMessage)
        .filter(AssistantMessage.conversation_id == convo.id)
        .order_by(AssistantMessage.id.desc())
        .limit(MAX_HISTORY_TURNS)
        .all()
    )
    messages: list[dict] = [
        {"role": m.role, "content": m.text} for m in reversed(stored)
    ]

    def _finish(reply: str, proposals: list[dict] | None) -> dict:
        if reply:
            db.add(AssistantMessage(
                conversation_id=convo.id, role="assistant", text=reply,
                created_at=utcnow(),
            ))
            convo.updated_at = utcnow()
            db.commit()
        return {
            "conversation_id": convo.id,
            "title": convo.title,
            "reply": reply,
            "proposals": proposals or [],
        }

    for _ in range(MAX_STEPS):
        try:
            response = client.beta.messages.create(
                model=settings.assistant_model,
                max_tokens=settings.assistant_max_tokens,
                system=_system_blocks(user),
                tools=[t.definition() for t in tools],
                messages=messages,
                output_config={"effort": settings.assistant_effort},
                # Recover automatically if a safety classifier declines the
                # turn, rather than showing staff a dead end.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except Exception as exc:  # noqa: BLE001 - mapped to a usable message below
            raise _upstream_error(exc) from exc

        # Always check the stop reason before reading content: on a refusal the
        # content list is empty or partial.
        if response.stop_reason == "refusal":
            return _finish(
                "I can't help with that one. Try rephrasing, or ask someone to "
                "look it up directly.",
                None,
            )

        if response.stop_reason != "tool_use":
            return _finish(_text_of(response) or "(no answer)", None)

        calls = [b for b in response.content if b.type == "tool_use"]

        # Write tools end the turn: they are proposals, not actions. Every one
        # in this response is collected so a multi-part request comes back as a
        # single batch to approve rather than a queue of confirmations.
        writes = [c for c in calls if (by_name.get(c.name) is not None and by_name[c.name].writes)]
        if writes:
            proposals = []
            for call in writes:
                args = dict(call.input or {})
                proposals.append({
                    "action": call.name,
                    "args": args,
                    "summary": describe(db, call.name, args),
                })
            return _finish(_text_of(response), proposals)

        # Otherwise run the reads and hand the results back.
        messages.append({"role": "assistant", "content": response.content})
        results = []
        for call in calls:
            tool = by_name.get(call.name)
            if tool is None or tool.run is None:
                results.append({
                    "type": "tool_result",
                    "tool_use_id": call.id,
                    "content": "That tool is not available to this user.",
                    "is_error": True,
                })
                continue
            try:
                out = tool.run(db, user, dict(call.input or {}))
            except APIError as exc:
                out, is_error = exc.message, True
            except Exception:  # noqa: BLE001 - a tool failure must not 500 the chat
                logger.exception("assistant_tool_failed", extra={"assistant_tool": call.name})
                out, is_error = "That lookup failed.", True
            else:
                is_error = False
            results.append({
                "type": "tool_result",
                "tool_use_id": call.id,
                "content": out,
                "is_error": is_error,
            })
        messages.append({"role": "user", "content": results})

    return _finish("I couldn't work that out — try asking it a different way.", None)
