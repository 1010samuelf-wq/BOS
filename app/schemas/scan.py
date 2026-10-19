from pydantic import BaseModel


class ScannedItem(BaseModel):
    product_id: int | None
    product_name: str | None
    catalog_price: str | None
    written_as: str
    quantity: int
    unit_price: str
    note: str


class ScannedOrder(BaseModel):
    customer_name: str
    customer_phone: str
    needed_for_date: str
    needed_for_time: str
    fulfillment: str
    delivery_name: str
    delivery_address: str
    payment_method: str  # cash | card | ""
    card_message: str
    notes: str
    items: list[ScannedItem]


class ScannedVendorInvoice(BaseModel):
    vendor_id: int | None
    vendor_name: str
    invoice_number: str
    date: str
    total: str


class ScanOut(BaseModel):
    kind: str  # order | vendor_invoice | unreadable
    order: ScannedOrder | None
    vendor_invoice: ScannedVendorInvoice | None
    warnings: list[str]


class ScanKindsOut(BaseModel):
    kinds: list[str]
    enabled: bool
