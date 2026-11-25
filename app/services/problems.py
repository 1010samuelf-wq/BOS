"""What needs someone's attention right now.

One scan over the shop's data for the things that go wrong quietly: an order
due today that isn't ready, money still owed on an order that has already left,
a shift nobody clocked out of, a website inquiry nobody answered. The easy
tablet's home screen shows the list, and the assistant reads the same list
(the `find_problems` tool) so it can explain one and propose the fix.

Each check belongs to a section, and a person only sees the checks for the
sections they have — the same rule as every other screen. Checks are cheap
queries with small limits; this runs on every visit to the home screen.

Times: `needed_for_date` is a wall-clock business value bucketed by its UTC
calendar day (see CLAUDE.md), so "today" here is `utc_today()`, the same
bucket the Orders and Production screens use.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.permissions import effective_sections
from app.models import (
    FulfillmentStatus,
    Ingredient,
    Inquiry,
    Order,
    OrderStatus,
    PaidStatus,
    Product,
    Task,
    TimeEntry,
    User,
    UserRole,
)
from app.models.base import utc_today, utcnow
from app.models.bookkeeping import Company, LedgerEntry
from app.models.enums import CompanyType, ItemType, LedgerEntryType
from app.models.stock import StockLevel

# A shift open longer than this was almost certainly never clocked out.
OPEN_SHIFT_HOURS = 14
# A supplier invoice unpaid for longer than this is worth a look.
INVOICE_DAYS = 30
# How many examples each problem names; the count says how many there are.
SHOWN = 5


@dataclass
class Problem:
    kind: str
    severity: str  # "high" | "medium" | "low"
    title: str
    detail: str
    count: int
    # Where to go to fix it: an order number, or a screen name the client maps.
    order_ids: list[int]
    screen: str


def _day_bounds(day) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=timezone.utc)
    return start, start + timedelta(days=1)


def _first(labels: list[str]) -> str:
    """The first few, and how many more there are."""
    more = len(labels) - SHOWN
    return ", ".join(labels[:SHOWN]) + (f" and {more} more" if more > 0 else "")


def _names(orders: list[Order]) -> str:
    return _first([f"#{o.id} {o.client_name}" for o in orders])


def _open_orders():
    return select(Order).where(
        Order.status != OrderStatus.cancelled,
        Order.fulfillment_status != FulfillmentStatus.fulfilled,
    )


def _overdue_orders(db: Session) -> Problem | None:
    start, _ = _day_bounds(utc_today())
    rows = db.scalars(
        _open_orders().where(Order.needed_for_date < start).order_by(Order.needed_for_date)
    ).all()
    if not rows:
        return None
    return Problem(
        "overdue_orders", "high",
        f"{len(rows)} order{'s' if len(rows) != 1 else ''} past their date and not picked up",
        f"{_names(rows)}. Either they were collected and never marked, or a customer is waiting.",
        len(rows), [o.id for o in rows[:SHOWN]], "orders",
    )


def _due_today_not_ready(db: Session) -> Problem | None:
    start, end = _day_bounds(utc_today())
    rows = db.scalars(
        _open_orders()
        .where(Order.needed_for_date >= start, Order.needed_for_date < end)
        .where(Order.status != OrderStatus.ready)
        .order_by(Order.needed_for_date)
    ).all()
    if not rows:
        return None
    return Problem(
        "due_today_not_ready", "medium",
        f"{len(rows)} order{'s' if len(rows) != 1 else ''} due today not marked ready",
        _names(rows) + ".",
        len(rows), [o.id for o in rows[:SHOWN]], "today",
    )


def _left_unpaid(db: Session) -> Problem | None:
    rows = db.scalars(
        select(Order)
        .where(
            Order.status != OrderStatus.cancelled,
            Order.fulfillment_status == FulfillmentStatus.fulfilled,
            Order.paid_status == PaidStatus.unpaid,
        )
        .order_by(Order.fulfilled_at.desc())
    ).all()
    if not rows:
        return None
    owed = sum((o.balance_due for o in rows), Decimal(0))
    return Problem(
        "fulfilled_unpaid", "high",
        f"${owed:.2f} still owed on {len(rows)} order{'s' if len(rows) != 1 else ''} already handed over",
        f"{_names(rows)}. Collect it, or mark it paid if it was.",
        len(rows), [o.id for o in rows[:SHOWN]], "orders",
    )


def _no_date(db: Session) -> Problem | None:
    week_ago = utcnow() - timedelta(days=2)
    rows = db.scalars(
        _open_orders()
        .where(Order.needed_for_date.is_(None), Order.order_date < week_ago)
        .order_by(Order.order_date)
    ).all()
    if not rows:
        return None
    return Problem(
        "orders_without_date", "low",
        f"{len(rows)} open order{'s' if len(rows) != 1 else ''} with no date",
        f"{_names(rows)}. Without a date they never show on the bake list.",
        len(rows), [o.id for o in rows[:SHOWN]], "orders",
    )


def _unanswered_inquiries(db: Session) -> Problem | None:
    rows = db.scalars(
        select(Inquiry).where(Inquiry.handled.is_(False)).order_by(Inquiry.created_at)
    ).all()
    if not rows:
        return None
    names = _first([r.customer_name for r in rows])
    return Problem(
        "unanswered_inquiries", "medium",
        f"{len(rows)} website request{'s' if len(rows) != 1 else ''} not answered",
        f"From {names}.",
        len(rows), [], "inquiries",
    )


def _low_ingredients(db: Session) -> Problem | None:
    rows = db.execute(
        select(Ingredient.name, StockLevel.quantity, Ingredient.unit)
        .join(StockLevel, (StockLevel.item_type == ItemType.ingredient) & (StockLevel.item_id == Ingredient.id))
        .where(StockLevel.quantity <= Ingredient.low_stock_threshold)
        .order_by(StockLevel.quantity)
    ).all()
    if not rows:
        return None
    shown = _first([f"{n} ({q.normalize():f} {u})" for n, q, u in rows])
    return Problem(
        "low_ingredients", "medium",
        f"{len(rows)} ingredient{'s' if len(rows) != 1 else ''} running low",
        shown + ".",
        len(rows), [], "stock",
    )


def _open_shifts(db: Session, user: User) -> Problem | None:
    cutoff = utcnow() - timedelta(hours=OPEN_SHIFT_HOURS)
    q = (
        select(TimeEntry, User.name)
        .join(User, User.id == TimeEntry.user_id)
        .where(TimeEntry.clock_out.is_(None), TimeEntry.clock_in < cutoff)
    )
    # Hours are personal: someone who doesn't manage staff sees only their own.
    if user.role not in (UserRole.manager, UserRole.admin):
        q = q.where(TimeEntry.user_id == user.id)
    rows = db.execute(q).all()
    if not rows:
        return None
    names = ", ".join(sorted({n for _, n in rows}))
    return Problem(
        "open_shifts", "medium",
        f"{len(rows)} shift{'s' if len(rows) != 1 else ''} never clocked out",
        f"{names} — clocked in over {OPEN_SHIFT_HOURS} hours ago. Fix the time out so the hours are right.",
        len(rows), [], "time",
    )


def _overdue_tasks(db: Session, user: User) -> Problem | None:
    q = select(Task).where(Task.done.is_(False), Task.due_date < utcnow())
    if user.role not in (UserRole.manager, UserRole.admin):
        q = q.where(Task.assigned_to == user.id)
    rows = db.scalars(q.order_by(Task.due_date)).all()
    if not rows:
        return None
    titles = _first([f'"{t.title}"' for t in rows])
    return Problem(
        "overdue_tasks", "low",
        f"{len(rows)} task{'s' if len(rows) != 1 else ''} past due",
        titles + ".",
        len(rows), [], "tasks",
    )


def _old_invoices(db: Session) -> Problem | None:
    cutoff = utc_today() - timedelta(days=INVOICE_DAYS)
    rows = db.execute(
        select(LedgerEntry, Company.name)
        .join(Company, Company.id == LedgerEntry.company_id)
        .where(
            Company.type == CompanyType.payable,
            LedgerEntry.type == LedgerEntryType.charge,
            LedgerEntry.paid_on.is_(None),
            LedgerEntry.entry_date < cutoff,
        )
        .order_by(LedgerEntry.entry_date)
    ).all()
    if not rows:
        return None
    total = sum((e.amount for e, _ in rows), Decimal(0))
    names = _first(sorted({n for _, n in rows}))
    return Problem(
        "old_vendor_invoices", "low",
        f"${total:.2f} in vendor invoices unpaid over {INVOICE_DAYS} days",
        f"{len(rows)} invoice{'s' if len(rows) != 1 else ''} — {names}. Mark them paid if they were.",
        len(rows), [], "vendors",
    )


def _website_gaps(db: Session) -> Problem | None:
    rows = db.scalars(
        select(Product)
        .where(Product.active.is_(True), Product.show_on_menu.is_(True), Product.photo_url.is_(None))
        .order_by(Product.name)
    ).all()
    if not rows:
        return None
    names = _first([p.name for p in rows])
    return Problem(
        "website_without_photos", "low",
        f"{len(rows)} product{'s' if len(rows) != 1 else ''} on the website with no photo",
        names + ".",
        len(rows), [], "products",
    )


def _product_names(db: Session) -> Problem | None:
    from app.services import product_flags

    flags = product_flags.find(db)
    if not flags:
        return None
    return Problem(
        "product_name_flags", "low",
        f"{len(flags)} product name{'s' if len(flags) != 1 else ''} to check",
        _first([f.describe() for f in flags]) + ". Fix the name, retire the double, or mark it fine.",
        len(flags), [], "products",
    )


# (section the person needs, check). A check that needs the person themself
# takes `user` too.
_CHECKS = [
    ("orders", _overdue_orders),
    ("orders", _left_unpaid),
    ("orders", _due_today_not_ready),
    ("orders", _unanswered_inquiries),
    ("orders", _no_date),
    ("stock", _low_ingredients),
    ("time", _open_shifts),
    ("tasks", _overdue_tasks),
    ("bookkeeping", _old_invoices),
    ("settings", _website_gaps),
    ("settings", _product_names),
]

_ORDER = {"high": 0, "medium": 1, "low": 2}


def find(db: Session, user: User) -> list[Problem]:
    """Every problem this person can see, worst first."""
    sections = effective_sections(user)
    found: list[Problem] = []
    for section, check in _CHECKS:
        if section not in sections:
            continue
        p = check(db, user) if check in (_open_shifts, _overdue_tasks) else check(db)
        if p is not None:
            found.append(p)
    return sorted(found, key=lambda p: _ORDER[p.severity])


def as_dicts(problems: list[Problem]) -> list[dict]:
    return [asdict(p) for p in problems]


def as_text(problems: list[Problem]) -> str:
    """For the assistant: one line per problem, with the order numbers it can act on."""
    if not problems:
        return "Nothing needs attention right now."
    lines = []
    for p in problems:
        ids = f" (orders {', '.join(f'#{i}' for i in p.order_ids)})" if p.order_ids else ""
        lines.append(f"- [{p.severity}] {p.title}: {p.detail}{ids}")
    return "\n".join(lines)
