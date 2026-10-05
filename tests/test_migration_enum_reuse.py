"""Migration 0026 must reuse the payment_method enum, not recreate it.

This exists because it already broke a deploy. `order_payments.method` reuses
the `payment_method` type that `0001_initial` created, and the first version of
the migration used `sa.Enum(..., create_type=False)` — a keyword `sa.Enum`
silently ignores, because it belongs to `postgresql.ENUM`. So the migration
emitted `CREATE TYPE payment_method AS ENUM (...)` and Postgres refused with
DuplicateObject. The release command caught it and nothing was applied, but the
deploy aborted.

The whole test suite runs on SQLite, where `sa.Enum` is a VARCHAR plus a CHECK
constraint and there is no type to collide with — so nothing else here can ever
catch this. These tests compile the DDL for the Postgres dialect instead, which
needs no Postgres server.
"""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
import pytest

MIGRATION = (
    Path(__file__).resolve().parent.parent
    / "alembic" / "versions" / "0026_order_payments.py"
)


@pytest.fixture
def migration():
    """Loaded by path: alembic/versions isn't an importable package, and the
    revision filename isn't a legal module name anyway."""
    spec = importlib.util.spec_from_file_location("migration_0026", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _emitted_ddl(column_type) -> list[str]:
    """Every DDL statement Postgres would receive for this column's table."""
    statements: list[str] = []
    engine = sa.create_mock_engine(
        "postgresql+psycopg://",
        lambda sql, *a, **kw: statements.append(
            str(sql.compile(dialect=engine.dialect)).strip()
        ),
    )
    md = sa.MetaData()
    sa.Table(
        "order_payments",
        md,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("method", column_type),
    )
    md.create_all(engine)
    return statements


class _FakeBind:
    def __init__(self, name):
        self.dialect = type("D", (), {"name": name})()


def test_the_postgres_column_does_not_recreate_the_type(migration):
    """The exact failure: a second CREATE TYPE for a type 0001 already made."""
    ddl = _emitted_ddl(migration._method_type(_FakeBind("postgresql")))

    assert not any("CREATE TYPE" in s for s in ddl), (
        "migration 0026 would emit CREATE TYPE payment_method again; "
        "Postgres refuses that with DuplicateObject"
    )
    assert any("CREATE TABLE order_payments" in s for s in ddl)


def test_the_column_still_has_the_enum_type(migration):
    """Not recreating it must not mean falling back to a plain string."""
    ddl = "\n".join(_emitted_ddl(migration._method_type(_FakeBind("postgresql"))))
    assert "payment_method" in ddl, ddl


def test_sa_enum_is_the_trap_this_guards(migration):
    """Proof the guard above is load-bearing, not vacuous.

    If `sa.Enum(create_type=False)` ever stopped emitting CREATE TYPE, the test
    above would pass for the wrong reason. Pin the broken behaviour so this file
    fails loudly if the assumption changes.
    """
    wrong = sa.Enum("cash", "card", "etransfer", name="payment_method", create_type=False)
    ddl = _emitted_ddl(wrong)

    assert any("CREATE TYPE" in s for s in ddl), (
        "sa.Enum no longer emits CREATE TYPE — re-check whether 0026 still "
        "needs postgresql.ENUM"
    )
    # And the reason: the keyword isn't even a real attribute of sa.Enum.
    assert not hasattr(wrong, "create_type")


def test_sqlite_gets_a_plain_enum(migration):
    """SQLite has no types to clash over, and the tests run there."""
    kind = migration._method_type(_FakeBind("sqlite"))
    assert isinstance(kind, sa.Enum)
    assert kind.name == "payment_method"


def test_the_values_match_the_live_enum(migration):
    """A reused type must be described with exactly the members it already has,
    or a value the app writes won't fit the column."""
    from app.models.enums import PaymentMethod

    kind = migration._method_type(_FakeBind("postgresql"))
    assert set(kind.enums) == {m.value for m in PaymentMethod}
