import enum


class UserRole(str, enum.Enum):
    cashier = "cashier"   # orders only
    manager = "manager"   # stock + orders
    admin = "admin"       # full access


class FulfillmentType(str, enum.Enum):
    pickup = "pickup"
    delivery = "delivery"


class PaymentTiming(str, enum.Enum):
    now = "now"
    later = "later"


class PaymentMethod(str, enum.Enum):
    cash = "cash"
    card = "card"
    etransfer = "etransfer"


class PaidStatus(str, enum.Enum):
    unpaid = "unpaid"
    paid = "paid"


class OrderStatus(str, enum.Enum):
    """Active-board pipeline. `cancelled` is terminal; fulfilment (delivered/
    picked up) is tracked separately on `Order.fulfillment_status`."""

    pending = "pending"
    in_progress = "in_progress"
    ready = "ready"
    cancelled = "cancelled"


class FulfillmentStatus(str, enum.Enum):
    pending = "pending"
    fulfilled = "fulfilled"   # delivered or picked up


class NoteType(str, enum.Enum):
    general = "general"
    payment = "payment"


class ItemType(str, enum.Enum):
    """What a stock row / recipe deduction refers to."""

    ingredient = "ingredient"
    product = "product"
