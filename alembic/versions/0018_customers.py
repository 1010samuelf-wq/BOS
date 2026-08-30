"""customers: promote the free-text client name/phone on orders to real records

Adds `customers`, adds `orders.customer_id`, and backfills a customer per
distinct person already in the orders table so existing history is linked
rather than starting empty.

Matching for the backfill is on digits-only phone where a phone exists, else on
a case- and whitespace-normalised name. That deliberately merges "Weiss
Catering" / "Weiss catering" and "514-272-0105" / "(514) 272 0105", which is the
whole point of the change.

Revision ID: 0018_customers
Revises: 0017_token_version
Create Date: 2026-08-30
"""
import re
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0018_customers"
down_revision = "0017_token_version"
branch_labels = None
depends_on = None


def _has_table(bind, table: str) -> bool:
    return table in inspect(bind).get_table_names()


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspect(bind).get_columns(table)}


def _phone_key(phone):
    return re.sub(r"\D", "", phone or "")


def _name_key(name):
    return " ".join((name or "").split()).casefold()


def upgrade() -> None:
    bind = op.get_bind()

    # Guarded: 0001_initial builds the schema from the current models, so on a
    # fresh database the table and column already exist by the time we get here.
    fresh = not _has_table(bind, "customers")
    if fresh:
        op.create_table(
            "customers",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("phone", sa.String(40), nullable=True),
            sa.Column("address", sa.Text(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_customers_name", "customers", ["name"])

    if not _has_column(bind, "orders", "customer_id"):
        op.add_column("orders", sa.Column("customer_id", sa.Integer(), nullable=True))
        op.create_index("ix_orders_customer_id", "orders", ["customer_id"])
        # SQLite cannot add a foreign key to an existing table; the ORM
        # relationship and the app enforce it there, Postgres gets the real
        # constraint (same approach as earlier revisions in this project).
        if bind.dialect.name == "postgresql":
            op.create_foreign_key(
                "fk_orders_customer_id", "orders", "customers", ["customer_id"], ["id"]
            )

    _backfill(bind)


def _backfill(bind) -> None:
    """One customer per distinct person already in `orders`.

    Two passes, because one is not enough. Grouping by phone alone leaves an
    order that was taken without a phone stranded as its own customer even when
    the name plainly matches — which is the very duplicate this change exists to
    remove. So: group by phone first, then fold phone-less orders into a phone
    group when their name matches exactly one of them.

    "Exactly one" matters: if two different people share a name and have
    different phones, a phone-less order for that name is genuinely ambiguous.
    Leaving it as its own record is the safer error — a spurious duplicate can
    be merged later, whereas two real customers merged into one cannot be
    separated again.

    Idempotent: only touches orders whose customer_id is still NULL, so a re-run
    or a partially applied migration cannot duplicate anyone.
    """
    rows = bind.execute(
        sa.text(
            "SELECT id, client_name, client_phone, delivery_address "
            "FROM orders WHERE customer_id IS NULL ORDER BY id"
        )
    ).fetchall()
    if not rows:
        return

    def blank_group():
        return {"names": {}, "phone": None, "address": None, "ids": []}

    def absorb(group, name, phone, address):
        group["ids"].append(oid)
        if name and name.strip():
            # Count spellings: in real data the correct one is used most often.
            display = " ".join(name.split())
            group["names"][display] = group["names"].get(display, 0) + 1
        if phone and phone.strip():
            group["phone"] = phone.strip()
        if address and address.strip():
            group["address"] = address.strip()

    phone_groups: dict[str, dict] = {}
    nameless: list[tuple] = []
    for oid, name, phone, address in rows:
        pk = _phone_key(phone)
        if pk:
            absorb(phone_groups.setdefault(pk, blank_group()), name, phone, address)
        else:
            nameless.append((oid, name, phone, address))

    # Which name keys does each phone group answer to?
    names_to_phone: dict[str, set] = {}
    for pk, g in phone_groups.items():
        for spelling in g["names"]:
            names_to_phone.setdefault(_name_key(spelling), set()).add(pk)

    name_groups: dict[str, dict] = {}
    for oid, name, phone, address in nameless:
        nk = _name_key(name)
        owners = names_to_phone.get(nk, set())
        if len(owners) == 1:
            absorb(phone_groups[next(iter(owners))], name, phone, address)
        else:
            absorb(name_groups.setdefault(nk, blank_group()), name, phone, address)

    now = datetime.now(timezone.utc)
    for g in list(phone_groups.values()) + list(name_groups.values()):
        # Most-used spelling wins; ties break toward the longer one, which is
        # usually the properly capitalised full version rather than an
        # abbreviation.
        display = (
            max(g["names"].items(), key=lambda kv: (kv[1], len(kv[0])))[0]
            if g["names"]
            else (g["phone"] or "Unknown")
        )
        result = bind.execute(
            sa.text(
                "INSERT INTO customers (name, phone, address, active, created_at, updated_at) "
                "VALUES (:name, :phone, :address, true, :now, :now)"
            ),
            {"name": display, "phone": g["phone"], "address": g["address"], "now": now},
        )
        customer_id = _last_insert_id(bind, result)
        bind.execute(
            sa.text("UPDATE orders SET customer_id = :cid WHERE id IN :ids").bindparams(
                sa.bindparam("ids", expanding=True)
            ),
            {"cid": customer_id, "ids": g["ids"]},
        )


def _last_insert_id(bind, result):
    if bind.dialect.name == "postgresql":
        return bind.execute(sa.text("SELECT lastval()")).scalar()
    return result.lastrowid


def downgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind, "orders", "customer_id"):
        if bind.dialect.name == "postgresql":
            op.drop_constraint("fk_orders_customer_id", "orders", type_="foreignkey")
        op.drop_column("orders", "customer_id")
    if _has_table(bind, "customers"):
        op.drop_table("customers")
