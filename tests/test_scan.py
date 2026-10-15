"""Scanning an order form or vendor invoice into a draft.

The AI is faked: these pin what the code is responsible for — the request it
builds, the IDs it trusts, the sections it honours, and never saving anything.
"""

import json
from types import SimpleNamespace

import pytest

from app.config import get_settings
from app.services import doc_scan

JPEG = b"\xff\xd8\xff\xe0fake"
PDF = b"%PDF-1.7 fake"


class FakeAI:
    def __init__(self, reply: dict | None = None, stop_reason: str = "end_turn"):
        self.reply = reply
        self.stop_reason = stop_reason
        self.calls = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.calls.append(kw)
        content = [] if self.reply is None else [SimpleNamespace(type="text", text=json.dumps(self.reply))]
        return SimpleNamespace(stop_reason=self.stop_reason, content=content)


def _empty_order():
    return {"customer_name": "", "customer_phone": "", "needed_for_date": "", "needed_for_time": "",
            "fulfillment": "", "delivery_address": "", "card_message": "", "notes": "", "items": []}


def _empty_invoice():
    return {"vendor_id": 0, "vendor_name": "", "invoice_number": "", "date": "", "total": ""}


@pytest.fixture
def ai(monkeypatch):
    def install(reply=None, stop_reason="end_turn"):
        fake = FakeAI(reply, stop_reason)
        monkeypatch.setattr(doc_scan, "_client", lambda: fake)
        return fake
    return install


def _scan(c, data=JPEG, ctype="image/jpeg", hint=None):
    form = {"hint": hint} if hint else {}
    return c.post("/api/v1/scan", files={"file": ("page", data, ctype)}, data=form)


def test_an_order_form_becomes_a_draft_with_real_product_ids(client, ai, make_product):
    babka = make_product(name="Chocolate Babka", price="18.00")
    retired = make_product(name="Old Cake", price="9.00", active=False)
    fake = ai({
        "kind": "order",
        "order": {**_empty_order(), "customer_name": "Mrs. Cohen", "customer_phone": "514-555-0100",
                  "needed_for_date": "2026-10-20", "needed_for_time": "9:30", "fulfillment": "pickup",
                  "items": [
                      {"product_id": babka["id"], "written_as": "choc babka", "quantity": 2, "unit_price": "", "note": ""},
                      {"product_id": retired["id"], "written_as": "old cake", "quantity": 1, "unit_price": "$9", "note": ""},
                      {"product_id": 99999, "written_as": "mystery", "quantity": 0, "unit_price": "abc", "note": "x"},
                  ]},
        "vendor_invoice": _empty_invoice(),
        "warnings": ["phone smudged"],
    })
    r = _scan(client)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "order"
    o = body["order"]
    assert (o["customer_name"], o["needed_for_date"], o["needed_for_time"]) == ("Mrs. Cohen", "2026-10-20", "09:30")
    first, second, third = o["items"]
    assert (first["product_id"], first["product_name"], first["quantity"]) == (babka["id"], "Chocolate Babka", 2)
    # Not for sale / doesn't exist: kept as written, no product link.
    assert second["product_id"] is None and second["written_as"] == "old cake" and second["unit_price"] == "9.00"
    assert third["product_id"] is None and third["quantity"] == 1 and third["unit_price"] == ""
    assert body["warnings"] == ["phone smudged"]

    call = fake.calls[0]
    assert call["model"] == get_settings().scan_model
    assert call["messages"][0]["content"][0]["type"] == "image"
    assert f"{babka['id']} | Chocolate Babka" in call["system"]
    assert "Old Cake" not in call["system"]  # retired products aren't offered


def test_a_pdf_is_sent_as_a_document(client, ai):
    fake = ai({"kind": "unreadable", "order": _empty_order(), "vendor_invoice": _empty_invoice(), "warnings": []})
    _scan(client, PDF, "application/pdf")
    block = fake.calls[0]["messages"][0]["content"][0]
    assert block["type"] == "document" and block["source"]["media_type"] == "application/pdf"


def test_a_vendor_invoice_matches_a_known_vendor(client, ai):
    vid = client.post("/api/v1/bookkeeping/companies", json={"name": "Flour Co", "type": "payable"}).json()["id"]
    cust = client.post("/api/v1/bookkeeping/companies", json={"name": "A Customer", "type": "receivable"}).json()["id"]
    fake = ai({"kind": "vendor_invoice", "order": _empty_order(), "warnings": [],
               "vendor_invoice": {"vendor_id": vid, "vendor_name": "FLOUR CO INC", "invoice_number": "INV-0042",
                                  "date": "2026-10-01", "total": "$1,234.50"}})
    v = _scan(client).json()["vendor_invoice"]
    assert v == {"vendor_id": vid, "vendor_name": "Flour Co", "invoice_number": "INV-0042",
                 "date": "2026-10-01", "total": "1234.50"}
    assert "A Customer" not in fake.calls[0]["system"]  # only vendors are offered


def test_an_unknown_vendor_keeps_the_printed_name(client, ai):
    ai({"kind": "vendor_invoice", "order": _empty_order(), "warnings": [],
        "vendor_invoice": {"vendor_id": 777, "vendor_name": "New Supplier Ltd", "invoice_number": "9",
                           "date": "Oct 1", "total": "50"}})
    v = _scan(client).json()["vendor_invoice"]
    assert (v["vendor_id"], v["vendor_name"], v["date"], v["total"]) == (None, "New Supplier Ltd", "", "50.00")


def test_scanning_saves_nothing(client, ai, make_product):
    p = make_product(name="Babka")
    ai({"kind": "order", "vendor_invoice": _empty_invoice(), "warnings": [],
        "order": {**_empty_order(), "items": [{"product_id": p["id"], "written_as": "babka", "quantity": 1,
                                               "unit_price": "", "note": ""}]}})
    assert _scan(client).json()["kind"] == "order"

    from sqlalchemy import func, select

    from app.database import SessionLocal
    from app.models import Order

    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Order)) == 0


def test_someone_without_bookkeeping_cant_get_an_invoice_draft(make_user, ai):
    _, _, cashier = make_user("Cashier Cass", "cashier")  # orders, no bookkeeping
    fake = ai({"kind": "vendor_invoice", "order": _empty_order(), "warnings": [],
               "vendor_invoice": {**_empty_invoice(), "vendor_name": "X", "total": "10"}})
    body = _scan(cashier).json()
    assert body["kind"] == "unreadable" and body["vendor_invoice"] is None
    assert "VENDOR_INVOICE" not in fake.calls[0]["system"]
    assert cashier.get("/api/v1/scan").json()["kinds"] == ["order"]


def test_needs_orders_or_bookkeeping(make_user, ai, client):
    from app.database import SessionLocal
    from app.models import User

    uid, _, c = make_user("Baker Bo", "cashier")
    with SessionLocal() as db:
        db.get(User, uid).permissions = ["time"]
        db.commit()
    ai({"kind": "unreadable", "order": _empty_order(), "vendor_invoice": _empty_invoice(), "warnings": []})
    assert _scan(c).status_code == 403


def test_bad_files_are_refused_before_the_ai_sees_them(client, ai):
    fake = ai({"kind": "unreadable", "order": _empty_order(), "vendor_invoice": _empty_invoice(), "warnings": []})
    assert _scan(client, b"heic", "image/heic").status_code == 400
    assert _scan(client, b"", "image/jpeg").status_code == 400
    assert fake.calls == []


def test_a_refusal_comes_back_as_unreadable_not_an_error(client, ai):
    ai(None, stop_reason="refusal")
    body = _scan(client).json()
    assert body["kind"] == "unreadable" and body["warnings"]


def test_without_an_api_key_it_says_so(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")
    assert _scan(client).status_code == 503
    assert client.get("/api/v1/scan").json()["enabled"] is False
