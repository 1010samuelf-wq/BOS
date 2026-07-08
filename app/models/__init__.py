"""SQLAlchemy models — the full BOS schema (spec §5).

All tables are defined here (schema is a Phase-1 deliverable), even though
only Orders/Inventory/Products/Ingredients/Recipes get API surface in Phase 1.
The rest (users beyond the stub, tasks, notifications, time_entries, expenses,
daily_reports) exist so later phases add endpoints without a second migration.
"""

from app.models.base import Base
from app.models.enums import (
    FulfillmentStatus,
    FulfillmentType,
    ItemType,
    NoteType,
    OrderStatus,
    PaidStatus,
    PaymentMethod,
    PaymentTiming,
    UserRole,
)
from app.models.catalog import Ingredient, Product, Recipe, RecipeItem
from app.models.order import Order, OrderItem, OrderNote
from app.models.settings import AppSettings
from app.models.stock import StockAdjustment, StockLevel
from app.models.user import User
from app.models.misc import (
    DailyReport,
    Expense,
    Notification,
    Task,
    TimeEntry,
)

__all__ = [
    "Base",
    "FulfillmentStatus",
    "FulfillmentType",
    "ItemType",
    "NoteType",
    "OrderStatus",
    "PaidStatus",
    "PaymentMethod",
    "PaymentTiming",
    "UserRole",
    "Ingredient",
    "Product",
    "Recipe",
    "RecipeItem",
    "Order",
    "OrderItem",
    "OrderNote",
    "AppSettings",
    "StockAdjustment",
    "StockLevel",
    "User",
    "DailyReport",
    "Expense",
    "Notification",
    "Task",
    "TimeEntry",
]
