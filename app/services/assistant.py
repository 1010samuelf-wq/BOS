"""The in-app assistant: answers questions about the shop, and proposes changes.

The safety model, in one line: **the model can read, and it can ask; only a
person can write.**

- Read tools run here, immediately, through the same service functions the REST
  API uses, scoped to the signed-in employee's permissions.
- Write tools are never executed by the model loop. The first one it calls ends
  the turn and comes back as a *proposal*. The confirmation sentence shown to
  the person is built by `describe()` from the validated arguments — not by the
  model — so what they approve is what actually runs.
- `execute()` runs a confirmed proposal through the ordinary service layer with
  the caller's own permissions re-checked, so the assistant can never do
  anything the person could not already do by clicking through the UI.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.errors import APIError
from app.core.permissions import effective_sections
from app.models import Order, User
from app.models.base import utc_today
from app.models.enums import NoteType, OrderStatus, PaymentMethod
from app.schemas.task import TaskCreate
from app.services import assistant_tools
from app.services import order as order_service
from app.services import tasks as task_service

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
matching tool once; that shows {name} exactly what you propose and they either \
confirm it or not. Do not claim anything has been done.
- Propose one change at a time, and only when it is clearly what was asked for.
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
    raise APIError(400, "bad_action", "That is not an action the assistant can take.")


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
    else:  # pragma: no cover - guarded by the registry check above
        raise APIError(400, "bad_action", "That is not an action the assistant can take.")

    db.commit()
    logger.info(
        "assistant_action",
        extra={"assistant_action": action, "assistant_actor": user.name},
    )
    return summary


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
    history: list[dict],
    *,
    client=None,
) -> dict:
    """Run one turn.

    `history` is plain {role, text} pairs. Tool calls are re-run from scratch
    each turn rather than replayed from the client, which keeps the browser
    from being able to forge tool results and means every answer is computed
    against current data.

    Returns {"reply": str, "proposal": {...} | None}.
    """
    settings = get_settings()
    client = client or _client()

    sections = effective_sections(user)
    tools = assistant_tools.tools_for(user, sections)
    by_name = {t.name: t for t in tools}

    messages: list[dict] = [
        {"role": m["role"], "content": m["text"]} for m in history if m.get("text")
    ]
    if not messages:
        raise APIError(400, "empty", "There is no message to answer.")

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
            return {
                "reply": "I can't help with that one. Try rephrasing, or ask "
                         "someone to look it up directly.",
                "proposal": None,
            }

        if response.stop_reason != "tool_use":
            return {"reply": _text_of(response) or "(no answer)", "proposal": None}

        calls = [b for b in response.content if b.type == "tool_use"]

        # A write tool ends the turn: it is a proposal, not an action.
        for call in calls:
            tool = by_name.get(call.name)
            if tool is not None and tool.writes:
                args = dict(call.input or {})
                return {
                    "reply": _text_of(response),
                    "proposal": {
                        "action": call.name,
                        "args": args,
                        "summary": describe(db, call.name, args),
                    },
                }

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

    return {
        "reply": "I couldn't work that out — try asking it a different way.",
        "proposal": None,
    }
