"""Tool surface the assistant is allowed to use.

Two kinds, and the split is the whole safety model:

* **Read tools** run immediately, server-side, through the same service
  functions the REST API uses — so they see exactly what the signed-in employee
  would see and nothing more.
* **Write tools never execute here.** They are validated and turned into a
  *proposal*; the person confirms it in the UI, and only then does
  `app/services/assistant.py` run it. The model can ask for a change but can
  never make one on its own.

Each tool declares the permission section it needs. The tool list is filtered
per user before it is sent to the model, so the model is never even told about
capabilities the employee doesn't have — it cannot offer to do something that
would only 403 afterwards.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.models import Expense, Order, Product, User, UserRole
from app.models.base import utc_today
from app.services import order as order_service
from app.services import reports as report_service
from app.services import tasks as task_service


class Tool:
    def __init__(
        self,
        name: str,
        description: str,
        schema: dict,
        section: str,
        *,
        writes: bool = False,
        manager_only: bool = False,
        admin_only: bool = False,
        run: Callable[[Session, User, dict], str] | None = None,
    ):
        self.name = name
        self.description = description
        self.schema = schema
        self.section = section
        self.writes = writes
        self.manager_only = manager_only
        self.admin_only = admin_only
        self.run = run

    def definition(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.schema,
        }


REGISTRY: dict[str, Tool] = {}


def _register(tool: Tool) -> Tool:
    REGISTRY[tool.name] = tool
    return tool


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}


_DATE = {"type": "string", "description": "Date as YYYY-MM-DD."}


# ---------------------------------------------------------------------------
# formatting helpers — the model reads these strings, so they carry units and
# labels rather than bare numbers.
# ---------------------------------------------------------------------------
def _money(v: Decimal | str | float | None) -> str:
    return f"${Decimal(str(v or 0)):.2f}"


def _order_line(o: Order) -> str:
    items = ", ".join(f"{i.quantity}x {i.product_name}" for i in o.items) or "no items"
    needed = o.needed_for_date.isoformat() if o.needed_for_date else "no date set"
    return (
        f"Order #{o.id} - {o.client_name}; needed {needed}; "
        f"{o.fulfillment_type.value}; status {o.status.value}; {o.paid_status.value}; "
        f"fulfillment {o.fulfillment_status.value}; total {_money(o.total)}; items: {items}"
    )


def _parse_date(value: str | None, fallback: date) -> date:
    return date.fromisoformat(value) if value else fallback


# ---------------------------------------------------------------------------
# read tools
# ---------------------------------------------------------------------------
def _run_list_orders(db: Session, user: User, args: dict) -> str:
    rows, total = order_service.list_orders(
        db,
        limit=min(int(args.get("limit", 20)), 50),
        offset=0,
        status=args.get("status"),
        paid_status=args.get("paid_status"),
        fulfillment_status=args.get("fulfillment_status"),
        fulfillment_type=args.get("fulfillment_type"),
        product_name=args.get("product_name"),
        from_date=_parse_date(args.get("from"), None) if args.get("from") else None,
        to_date=_parse_date(args.get("to"), None) if args.get("to") else None,
        date_field=args.get("date_field", "needed"),
        sort=args.get("sort", "needed_asc"),
        exclude_cancelled=bool(args.get("exclude_cancelled", True)),
    )
    if not rows:
        return "No orders matched."
    body = "\n".join(_order_line(o) for o in rows)
    return f"{total} order(s) matched; showing {len(rows)}.\n{body}"


_register(Tool(
    "list_orders",
    "Find orders. Call this whenever the question is about which orders exist, "
    "what is due on a day, what is unpaid, what is still to be fulfilled, or "
    "which orders contain a product. The from/to range filters on the "
    "needed-for date by default. Returns at most 50 orders.",
    _obj({
        "from": _DATE,
        "to": _DATE,
        "date_field": {
            "type": "string", "enum": ["order", "needed"],
            "description": "Which date from/to filters on. Default 'needed'.",
        },
        "status": {"type": "string", "enum": ["pending", "in_progress", "ready", "cancelled"]},
        "paid_status": {"type": "string", "enum": ["paid", "unpaid"]},
        "fulfillment_status": {"type": "string", "enum": ["pending", "fulfilled"]},
        "fulfillment_type": {"type": "string", "enum": ["pickup", "delivery"]},
        "product_name": {"type": "string", "description": "Substring match on a product in the order."},
        "sort": {"type": "string", "enum": ["needed_asc", "needed_desc", "order_asc", "order_desc"]},
        "exclude_cancelled": {"type": "boolean", "description": "Default true."},
        "limit": {"type": "integer", "description": "Max orders to return, up to 50. Default 20."},
    }),
    "orders",
    run=_run_list_orders,
))


def _run_get_order(db: Session, user: User, args: dict) -> str:
    o = order_service.get_order(db, int(args["order_id"]))
    notes = "; ".join(f"{'[done] ' if n.done else ''}{n.text}" for n in o.notes) or "none"
    method = o.payment_method.value if o.payment_method else "-"
    return (
        f"{_order_line(o)}\n"
        f"Phone: {o.client_phone or '-'}; delivery name: {o.delivery_name or '-'}; "
        f"address: {o.delivery_address or '-'}\n"
        f"Payment: timing {o.payment_timing.value}, method {method}\n"
        f"Notes: {notes}"
    )


_register(Tool(
    "get_order",
    "Read one order in full, including phone, delivery details and notes. Call "
    "this when the person names a specific order number, or after list_orders "
    "when more detail on one order is needed.",
    _obj({"order_id": {"type": "integer"}}, ["order_id"]),
    "orders",
    run=_run_get_order,
))


def _run_sales(db: Session, user: User, args: dict) -> str:
    today = utc_today()
    rep = report_service.sales_report(
        db, _parse_date(args.get("from"), today), _parse_date(args.get("to"), today)
    )
    lines = [
        f"Sales {rep.from_date} to {rep.to_date} (cash basis - only paid orders count):",
        f"  revenue {_money(rep.revenue)}; orders {rep.order_count}; "
        f"ingredient cost {_money(rep.ingredient_cost)}; labor {_money(rep.labor_cost)}; "
        f"expenses {_money(rep.expenses)}; profit {_money(rep.profit)}",
    ]
    for b in rep.payment_breakdown:
        lines.append(f"  {b.payment_method}: {_money(b.amount)} over {b.order_count} order(s)")
    return "\n".join(lines)


_register(Tool(
    "sales_report",
    "Revenue, costs and profit for a date range. Call this for any money "
    "question - how much did we make, what was profit, how did people pay. "
    "Defaults to today when no range is given. Cash-basis: only paid orders "
    "and paid-out shifts are counted.",
    _obj({"from": _DATE, "to": _DATE}),
    "reports",
    run=_run_sales,
))


def _run_production(db: Session, user: User, args: dict) -> str:
    today = utc_today()
    rep = report_service.production_report(
        db, _parse_date(args.get("from"), today), _parse_date(args.get("to"), today)
    )
    if not rep.products:
        return f"Nothing to bake for {rep.from_date} to {rep.to_date}."
    lines = [f"Bake list {rep.from_date} to {rep.to_date}:"]
    for p in rep.products:
        lines.append(
            f"  {p.product_name}: needed {p.needed}, in stock {p.in_stock}, to bake {p.to_bake}"
        )
    return "\n".join(lines)


_register(Tool(
    "production_report",
    "The bake list - what needs producing for a date range, and how much is "
    "already in stock. Call this for 'what do we need to bake' questions. "
    "Defaults to today.",
    _obj({"from": _DATE, "to": _DATE}),
    "production",
    run=_run_production,
))


def _run_deliveries(db: Session, user: User, args: dict) -> str:
    today = utc_today()
    rep = report_service.deliveries_manifest(
        db, _parse_date(args.get("from"), today), _parse_date(args.get("to"), today)
    )
    if not rep.rows:
        return f"No deliveries scheduled {rep.from_date} to {rep.to_date}."
    lines = [f"Deliveries {rep.from_date} to {rep.to_date}:"]
    for r in rep.rows:
        when = r.needed_for_date.isoformat() if r.needed_for_date else "no time set"
        lines.append(
            f"  Order #{r.order_id} - {r.client_name}; recipient {r.delivery_name or '-'}; "
            f"{r.delivery_address or 'no address'}; {when}; {r.paid_status}"
        )
    return "\n".join(lines)


_register(Tool(
    "deliveries",
    "Deliveries scheduled in a date range, with addresses and recipients. Call "
    "this for driver and route questions. Defaults to today.",
    _obj({"from": _DATE, "to": _DATE}),
    "deliveries",
    run=_run_deliveries,
))


def _run_list_tasks(db: Session, user: User, args: dict) -> str:
    is_manager = user.role in (UserRole.manager, UserRole.admin)
    employee_id = args.get("employee_id")
    # Non-managers are scoped to their own tasks, exactly as the REST route does.
    if not is_manager:
        employee_id = user.id
    rows = task_service.list_tasks(
        db, employee_id=employee_id, on_date=None, done=args.get("done")
    )
    if not rows:
        return "No tasks matched."
    out = []
    for t in rows:
        who = db.get(User, t.assigned_to)
        due = t.due_date.isoformat() if t.due_date else "no due date"
        out.append(
            f"Task #{t.id} - {t.title}; for {who.name if who else t.assigned_to}; "
            f"due {due}; {'done' if t.done else 'not done'}"
        )
    return "\n".join(out)


_register(Tool(
    "list_tasks",
    "Assigned to-dos. Call this for 'what is on my list', or for a manager "
    "'what is X working on'. A non-manager only ever sees their own tasks.",
    _obj({
        "employee_id": {"type": "integer", "description": "Manager/admin only; omit for your own."},
        "done": {"type": "boolean", "description": "Filter by completion."},
    }),
    "tasks",
    run=_run_list_tasks,
))


def _run_hours(db: Session, user: User, args: dict) -> str:
    rep = report_service.all_staff_hours(db, _parse_date(args.get("day"), utc_today()))
    if not rep.rows:
        return "No hours recorded for that week."
    lines = [f"Staff hours for week {rep.week_start} to {rep.week_end}:"]
    for r in rep.rows:
        lines.append(f"  {r.name}: {r.total_hours:.2f} h")
    return "\n".join(lines)


_register(Tool(
    "staff_hours",
    "Hours worked per employee for the week containing a given day. Call this "
    "for payroll and 'who worked how much' questions. Defaults to this week.",
    _obj({"day": _DATE}),
    "time",
    run=_run_hours,
))


def _run_list_employees(db: Session, user: User, args: dict) -> str:
    rows = db.query(User).filter(User.active.is_(True)).order_by(User.name).all()
    listed = "\n".join(f"id {u.id}: {u.name} ({u.role.value})" for u in rows)
    return listed or "No active employees."


_register(Tool(
    "list_employees",
    "Active employees and their ids. Call this when you need an employee id in "
    "order to assign a task, or when asked who works here.",
    _obj({}),
    "tasks",
    run=_run_list_employees,
))


def _run_find_products(db: Session, user: User, args: dict) -> str:
    q = str(args.get("query", "")).strip()
    stmt = db.query(Product).filter(Product.active.is_(True))
    if q:
        stmt = stmt.filter(Product.name.ilike(f"%{q}%"))
    rows = stmt.order_by(Product.name).limit(40).all()
    if not rows:
        return "No matching products in the catalog."
    return "\n".join(
        f"id {p.id}: {p.name} - {_money(p.price)}"
        f"{f' ({p.category})' if p.category else ''}"
        for p in rows
    )


_register(Tool(
    "find_products",
    "Search the product catalog and get product ids and prices. You MUST call "
    "this before proposing an order, to turn the names someone says into real "
    "product ids and confirm the price. Omit the query to list everything.",
    _obj({"query": {"type": "string", "description": "Part of a product name."}}),
    "orders",
    run=_run_find_products,
))


def _run_list_expenses(db: Session, user: User, args: dict) -> str:
    today = utc_today()
    start = _parse_date(args.get("from"), today)
    end = _parse_date(args.get("to"), today)
    rows = (
        db.query(Expense)
        .filter(Expense.spent_on >= start, Expense.spent_on <= end)
        .order_by(Expense.spent_on.desc(), Expense.id.desc())
        .limit(50)
        .all()
    )
    if not rows:
        return f"No expenses recorded {start} to {end}."
    lines = [f"Expenses {start} to {end}:"]
    for e in rows:
        lines.append(
            f"  id {e.id}: {e.spent_on} - {e.description}; {_money(e.amount)}"
            f"{f'; {e.category}' if e.category else ''}"
        )
    return "\n".join(lines)


_register(Tool(
    "list_expenses",
    "Expenses recorded in a date range, with their ids. Call this before "
    "proposing to delete one, and to answer 'what did we spend on X'. Defaults "
    "to today.",
    _obj({"from": _DATE, "to": _DATE}),
    "reports",
    run=_run_list_expenses,
))


# ---------------------------------------------------------------------------
# write tools that create or destroy records
# ---------------------------------------------------------------------------
_register(Tool(
    "create_order",
    "Propose a new order. Call find_products first so every line uses a real "
    "product id and price. Give each item either a product_id OR a "
    "custom_name plus custom_price for something not in the catalog. A "
    "delivery needs delivery_address. Paying now needs payment_method; paying "
    "later must not have one. Ask for anything you are missing rather than "
    "inventing it — especially the customer's name, what they want, and when "
    "it is needed. Does not take effect until the person confirms it on screen.",
    _obj({
        "client_name": {"type": "string"},
        "client_phone": {"type": "string"},
        "needed_for_date": {
            "type": "string",
            "description": "When it is needed: YYYY-MM-DD, or YYYY-MM-DDTHH:MM for a time.",
        },
        "fulfillment_type": {"type": "string", "enum": ["pickup", "delivery"]},
        "delivery_address": {"type": "string", "description": "Required for delivery."},
        "delivery_name": {"type": "string", "description": "Who receives it, if not the client."},
        "card_message": {"type": "string"},
        "payment_timing": {"type": "string", "enum": ["now", "later"]},
        "payment_method": {
            "type": "string", "enum": ["cash", "card", "etransfer"],
            "description": "Required when paying now; omit when paying later.",
        },
        "items": {
            "type": "array",
            "description": "At least one line.",
            "items": _obj({
                "product_id": {"type": "integer", "description": "From find_products."},
                "custom_name": {"type": "string", "description": "For an item not in the catalog."},
                "custom_price": {"type": "number", "description": "Unit price for a custom item."},
                "quantity": {"type": "integer"},
            }, ["quantity"]),
        },
    }, ["client_name", "fulfillment_type", "payment_timing", "items"]),
    "orders",
    writes=True,
))

_register(Tool(
    "create_expense",
    "Propose recording a business expense — a supplier bill, fuel, repairs. "
    "Expenses reduce profit in the reports. Defaults to today when no date is "
    "given. Does not take effect until the person confirms it on screen.",
    _obj({
        "description": {"type": "string", "description": "What it was for, e.g. 'Sysco - flour'."},
        "amount": {"type": "number", "description": "Dollars, e.g. 284.60."},
        "category": {"type": "string", "description": "Optional grouping, e.g. Ingredients."},
        "spent_on": _DATE,
    }, ["description", "amount"]),
    "reports",
    writes=True,
))

_register(Tool(
    "delete_expense",
    "Propose permanently deleting an expense — use for a duplicate or a "
    "mistake. Call list_expenses first to get the right id. This cannot be "
    "undone. Does not take effect until the person confirms it on screen.",
    _obj({"expense_id": {"type": "integer"}}, ["expense_id"]),
    "reports",
    writes=True,
))

_register(Tool(
    "delete_order",
    "Propose permanently deleting an order. Admin only, and only possible for "
    "an order that is ALREADY cancelled — this is for clearing out test or "
    "mistaken entries, not for calling off a real order. To call off a real "
    "order use cancel_order instead. This cannot be undone. Does not take "
    "effect until the person confirms it on screen.",
    _obj({"order_id": {"type": "integer"}}, ["order_id"]),
    "orders",
    writes=True,
    admin_only=True,
))

_register(Tool(
    "mark_task_done",
    "Propose ticking a task off, or reopening it. Does not take effect until "
    "the person confirms it on screen.",
    _obj({
        "task_id": {"type": "integer"},
        "done": {"type": "boolean", "description": "True to complete, false to reopen. Default true."},
    }, ["task_id"]),
    "tasks",
    writes=True,
))


# ---------------------------------------------------------------------------
# write tools - declared so the model can *propose*; never executed here
# ---------------------------------------------------------------------------
_register(Tool(
    "mark_order_paid",
    "Propose marking an order as paid. Use when someone says a customer has now "
    "paid. This does not take effect until the person confirms it on screen.",
    _obj({
        "order_id": {"type": "integer"},
        "payment_method": {"type": "string", "enum": ["cash", "card", "etransfer"]},
    }, ["order_id"]),
    "orders",
    writes=True,
))

_register(Tool(
    "fulfill_order",
    "Propose marking an order as fulfilled - picked up or delivered. Does not "
    "take effect until the person confirms it on screen.",
    _obj({"order_id": {"type": "integer"}}, ["order_id"]),
    "orders",
    writes=True,
))

_register(Tool(
    "set_order_status",
    "Propose moving an order along the board: pending, in_progress or ready. "
    "Does not take effect until the person confirms it on screen.",
    _obj({
        "order_id": {"type": "integer"},
        "status": {"type": "string", "enum": ["pending", "in_progress", "ready"]},
    }, ["order_id", "status"]),
    "orders",
    writes=True,
))

_register(Tool(
    "cancel_order",
    "Propose cancelling an order. Ask whether the stock should go back if it is "
    "not obvious. Does not take effect until the person confirms it on screen.",
    _obj({
        "order_id": {"type": "integer"},
        "return_stock": {
            "type": "boolean",
            "description": "Put the items back into stock. Default true.",
        },
    }, ["order_id"]),
    "orders",
    writes=True,
))

_register(Tool(
    "add_order_note",
    "Propose adding a note to an order. Does not take effect until the person "
    "confirms it on screen.",
    _obj({
        "order_id": {"type": "integer"},
        "text": {"type": "string"},
    }, ["order_id", "text"]),
    "orders",
    writes=True,
))

_register(Tool(
    "create_task",
    "Propose assigning a task to an employee. Manager or admin only. Does not "
    "take effect until the person confirms it on screen.",
    _obj({
        "title": {"type": "string"},
        "assigned_to": {"type": "integer", "description": "Employee id; use list_employees if unsure."},
        "due_date": _DATE,
    }, ["title", "assigned_to"]),
    "tasks",
    writes=True,
    manager_only=True,
))


def tools_for(user: User, sections: set[str]) -> list[Tool]:
    """The subset of tools this employee may use.

    Filtering here - rather than erroring at call time - means the model is
    never told about a capability the person lacks, so it cannot offer to do
    something that would only fail afterwards.
    """
    is_manager = user.role in (UserRole.manager, UserRole.admin)
    is_admin = user.role == UserRole.admin
    return [
        t for t in REGISTRY.values()
        if t.section in sections
        and (is_manager or not t.manager_only)
        and (is_admin or not t.admin_only)
    ]
