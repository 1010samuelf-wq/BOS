"""SQLAlchemy models — the full BOS schema (spec §5).

All tables are defined here (schema is a Phase-1 deliverable), even though
only Orders/Inventory/Products/Ingredients/Recipes get API surface in Phase 1.
The rest (users beyond the stub, tasks, notifications, time_entries, expenses,
daily_reports) exist so later phases add endpoints without a second migration.
"""

from app.models.base import Base
from app.models.enums import (
    CompanyType,
    FulfillmentStatus,
    FulfillmentType,
    ItemType,
    LedgerEntryType,
    NoteType,
    OrderStatus,
    PaidStatus,
    PaymentMethod,
    PaymentTiming,
    UserRole,
)
from app.models.bookkeeping import Company, LedgerEntry
from app.models.catalog import Ingredient, Product, Recipe, RecipeItem
from app.models.order import Order, OrderItem, OrderNote
from app.models.settings import AppSettings
from app.models.stock import StockAdjustment, StockLevel
from app.models.sync import SyncedOperation
from app.models.user import User
from app.models.misc import (
    DailyReport,
    Expense,
    Inquiry,
    Notification,
    Task,
    TimeEntry,
)

__all__ = [
    "Base",
    "CompanyType",
    "FulfillmentStatus",
    "FulfillmentType",
    "ItemType",
    "LedgerEntryType",
    "NoteType",
    "OrderStatus",
    "PaidStatus",
    "PaymentMethod",
    "PaymentTiming",
    "UserRole",
    "Company",
    "LedgerEntry",
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
    "SyncedOperation",
    "User",
    "DailyReport",
    "Expense",
    "Inquiry",
    "Notification",
    "Task",
    "TimeEntry",
]
