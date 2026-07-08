"""Reporting & bookkeeping aggregation (spec §2D, §2A, §2G).

Date ranges are inclusive calendar dates interpreted in UTC. Financial reports
key off ``order_date`` (when the sale happened); the production and deliveries
reports key off ``needed_for_date`` (when goods are due). Cancelled orders are
excluded everywhere; the production/deliveries views also exclude fulfilled
orders (already baked / already out the door).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

_CENTS = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return value.quantize(_CENTS, rounding=ROUND_HALF_UP)

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Expense,
    FulfillmentStatus,
    FulfillmentType,
    Ingredient,
    ItemType,
    Order,
    OrderItem,
    OrderStatus,
    PaidStatus,
    PaymentMethod,
    Product,
    Recipe,
    RecipeItem,
    StockLevel,
    TimeEntry,
    User,
)
from app.schemas.report import (
    DeliveriesOut,
    DeliveryItem,
    DeliveryRow,
    HoursReportOut,
    PaymentBreakdown,
    ProductionReportOut,
    ProductionRow,
    SalesReportOut,
    StaffHoursRow,
)
from app.schemas.expense import ExpenseOut
from app.services.time_tracking import aggregate_week, week_bounds


def _bounds(from_date: date, to_date: date) -> tuple[datetime, datetime]:
    """Half-open UTC datetime range [from 00:00, to+1 00:00)."""
    start = datetime(from_date.year, from_date.month, from_date.day, tzinfo=timezone.utc)
    end = datetime(to_date.year, to_date.month, to_date.day, tzinfo=timezone.utc) + timedelta(days=1)
    return start, end


# ---- ingredient cost (COGS) -------------------------------------------------
def product_ingredient_cost(db: Session, product_id: int, _cache: dict) -> Decimal:
    """Recipe cost of one unit of a product = Σ(qty × ingredient cost_per_unit).
    Products without a recipe contribute 0 (cost unknown). Cached per report."""
    if product_id in _cache:
        return _cache[product_id]
    recipe = db.execute(
        select(Recipe).where(Recipe.product_id == product_id).options(
            selectinload(Recipe.items).selectinload(RecipeItem.ingredient)
        )
    ).scalar_one_or_none()
    cost = Decimal(0)
    if recipe is not None:
        for ri in recipe.items:
            cost += ri.quantity * ri.ingredient.cost_per_unit
    _cache[product_id] = cost
    return cost


# ---- sales / bookkeeping ----------------------------------------------------
def sales_report(db: Session, from_date: date, to_date: date) -> SalesReportOut:
    start, end = _bounds(from_date, to_date)

    orders = db.execute(
        select(Order)
        .where(
            Order.order_date >= start,
            Order.order_date < end,
            Order.status != OrderStatus.cancelled,
        )
        .options(selectinload(Order.items))
    ).scalars().all()

    revenue = Decimal(0)
    ingredient_cost = Decimal(0)
    breakdown = {
        "cash": Decimal(0),
        "card": Decimal(0),
        "etransfer": Decimal(0),
        "unspecified": Decimal(0),
        "unpaid": Decimal(0),
    }
    cost_cache: dict = {}

    for order in orders:
        revenue += order.total
        if order.paid_status == PaidStatus.unpaid:
            breakdown["unpaid"] += order.total
        elif order.payment_method == PaymentMethod.cash:
            breakdown["cash"] += order.total
        elif order.payment_method == PaymentMethod.card:
            breakdown["card"] += order.total
        elif order.payment_method == PaymentMethod.etransfer:
            breakdown["etransfer"] += order.total
        else:
            breakdown["unspecified"] += order.total

        for item in order.items:
            ingredient_cost += product_ingredient_cost(db, item.product_id, cost_cache) * item.quantity

    expenses = db.execute(
        select(Expense)
        .where(Expense.spent_on >= from_date, Expense.spent_on <= to_date)
        .order_by(Expense.spent_on, Expense.id)
    ).scalars().all()
    expenses_total = sum((e.amount for e in expenses), Decimal(0))
    profit = revenue - ingredient_cost - expenses_total

    return SalesReportOut(
        from_date=from_date,
        to_date=to_date,
        revenue=_money(revenue),
        order_count=len(orders),
        ingredient_cost=_money(ingredient_cost),
        expenses_total=_money(expenses_total),
        profit=_money(profit),
        payment_breakdown=PaymentBreakdown(**{k: _money(v) for k, v in breakdown.items()}),
        expenses=[ExpenseOut.model_validate(e) for e in expenses],
    )


# ---- production summary / bake list -----------------------------------------
def production_report(
    db: Session,
    from_date: date,
    to_date: date,
    fulfillment: FulfillmentType | None = None,
) -> ProductionReportOut:
    start, end = _bounds(from_date, to_date)

    filters = [
        Order.needed_for_date >= start,
        Order.needed_for_date < end,
        Order.status != OrderStatus.cancelled,
        Order.fulfillment_status != FulfillmentStatus.fulfilled,
    ]
    if fulfillment is not None:
        filters.append(Order.fulfillment_type == fulfillment)

    # Σ quantity + count of distinct contributing orders, per product.
    rows = db.execute(
        select(
            OrderItem.product_id,
            OrderItem.product_name,
            func.sum(OrderItem.quantity),
            func.count(func.distinct(OrderItem.order_id)),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .where(*filters)
        .group_by(OrderItem.product_id, OrderItem.product_name)
        .order_by(OrderItem.product_name)
    ).all()

    out_rows: list[ProductionRow] = []
    total_needed = 0
    total_to_bake = Decimal(0)
    for product_id, name, qty, order_count in rows:
        needed = int(qty or 0)
        in_stock = db.scalar(
            select(StockLevel.quantity).where(
                StockLevel.item_type == ItemType.product,
                StockLevel.item_id == product_id,
            )
        ) or Decimal(0)
        to_bake = needed - in_stock
        if to_bake < 0:
            to_bake = Decimal(0)
        total_needed += needed
        total_to_bake += to_bake
        out_rows.append(
            ProductionRow(
                product_id=product_id,
                product_name=name,
                total_quantity=needed,
                order_count=int(order_count),
                in_stock=in_stock,
                to_bake=to_bake,
            )
        )

    return ProductionReportOut(
        from_date=from_date,
        to_date=to_date,
        rows=out_rows,
        total_needed=total_needed,
        total_to_bake=total_to_bake,
    )


# ---- deliveries manifest ----------------------------------------------------
def deliveries_manifest(db: Session, from_date: date, to_date: date) -> DeliveriesOut:
    start, end = _bounds(from_date, to_date)

    orders = db.execute(
        select(Order)
        .where(
            Order.fulfillment_type == FulfillmentType.delivery,
            Order.needed_for_date >= start,
            Order.needed_for_date < end,
            Order.status != OrderStatus.cancelled,
        )
        .options(selectinload(Order.items))
        .order_by(Order.needed_for_date)
    ).scalars().all()

    rows = [
        DeliveryRow(
            order_id=o.id,
            needed_for_date=o.needed_for_date,
            client_name=o.client_name,
            client_phone=o.client_phone,
            delivery_address=o.delivery_address,
            delivery_name=o.delivery_name,
            items=[DeliveryItem(product_name=i.product_name, quantity=i.quantity) for i in o.items],
            box_count=len(o.items),  # distinct line items, not summed qty (§2A)
            total=o.total,
            paid_status=o.paid_status.value,
        )
        for o in orders
    ]
    return DeliveriesOut(from_date=from_date, to_date=to_date, rows=rows)


# ---- all-staff weekly hours -------------------------------------------------
def all_staff_hours(db: Session, any_day: date) -> HoursReportOut:
    monday, sunday = week_bounds(any_day)
    week_start = datetime(monday.year, monday.month, monday.day, tzinfo=timezone.utc)
    week_end = week_start + timedelta(days=7)

    users = db.execute(
        select(User).where(User.active.is_(True)).order_by(User.name)
    ).scalars().all()

    rows: list[StaffHoursRow] = []
    grand = 0.0
    for user in users:
        entries = db.execute(
            select(TimeEntry).where(
                TimeEntry.user_id == user.id,
                TimeEntry.clock_in >= week_start,
                TimeEntry.clock_in < week_end,
            )
        ).scalars().all()
        _, total = aggregate_week([(e.clock_in, e.clock_out) for e in entries], any_day)
        if total > 0:
            grand += total
        rows.append(StaffHoursRow(user_id=user.id, name=user.name, total_hours=total))

    return HoursReportOut(
        week_start=monday,
        week_end=sunday,
        rows=rows,
        grand_total_hours=round(grand, 2),
    )
