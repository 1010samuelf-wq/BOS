"""Loading a supplier price sheet into the ingredient list."""

from decimal import Decimal
from pathlib import Path

import pytest

from app.database import SessionLocal
from app.models import Ingredient
from app.tools import ingredient_prices as tool
from app.tools.ingredient_prices import Row, price_per

SHEET = Path(__file__).resolve().parent.parent / "app/tools/data/ingredient_prices_2026-10.csv"


def _row(name, qty, pack_unit, price, unit):
    return Row(name, Decimal(qty), pack_unit, Decimal(price), unit)


def _add(db, name, unit, cost):
    ing = Ingredient(name=name, unit=unit, cost_per_unit=Decimal(cost))
    db.add(ing)
    db.commit()
    return ing.id


@pytest.fixture
def db():
    with SessionLocal() as s:
        yield s


def test_price_per_unit_is_pack_price_over_pack_size():
    assert price_per(Decimal("180"), "ea", Decimal("52.00"), "ea") == Decimal("0.2889")
    assert price_per(Decimal("1.89"), "L", Decimal("6.19"), "L") == Decimal("3.2751")


def test_grams_are_converted_to_pounds():
    # 12 x 680 g = 8160 g = 17.99 lb for $83
    assert price_per(Decimal("8160"), "g", Decimal("83"), "lb") == Decimal("4.6137")


def test_incomparable_units_give_no_price():
    assert price_per(Decimal("12"), "pkg", Decimal("135"), "lb") is None
    assert price_per(Decimal("1"), "lb", Decimal("5"), "L") is None


def test_new_ingredients_are_added_with_the_sheet_unit(db):
    changes = tool.plan(db, [_row("Pecans", "1", "lb", "20.00", "lb")])
    tool.apply(db, changes)
    db.commit()
    ing = db.query(Ingredient).filter_by(name="Pecans").one()
    assert (ing.unit, ing.cost_per_unit) == ("lb", Decimal("20.0000"))


def test_an_existing_ingredient_keeps_its_unit_and_the_price_is_converted(db):
    # Recipes store quantities in the ingredient's unit, so a kg ingredient
    # must stay per kg: $13.99/lb is $30.8427/kg.
    iid = _add(db, "Butter", "kg", "25.00")
    changes = tool.plan(db, [_row("Butter", "1", "lb", "13.99", "lb")])
    assert [c.action for c in changes] == ["update"]
    tool.apply(db, changes)
    db.commit()
    db.expire_all()
    ing = db.get(Ingredient, iid)
    assert ing.unit == "kg"
    assert ing.cost_per_unit == Decimal("30.8427")


def test_matching_ignores_case_and_spacing(db):
    iid = _add(db, "  all-purpose   FLOUR ", "lb", "0.50")
    changes = tool.plan(db, [_row("All-purpose flour", "44.09", "lb", "29.99", "lb")])
    assert (changes[0].action, changes[0].ingredient_id) == ("update", iid)


def test_a_unit_that_cannot_be_converted_is_skipped_not_guessed(db):
    _add(db, "Eggs (whole)", "lb", "3.00")
    changes = tool.plan(db, [_row("Eggs (whole)", "180", "ea", "52.00", "ea")])
    assert changes[0].action == "skip"
    tool.apply(db, changes)
    db.commit()
    assert db.query(Ingredient).filter_by(name="Eggs (whole)").one().cost_per_unit == Decimal("3.00")


def test_an_unchanged_price_is_left_alone(db):
    _add(db, "Salt", "lb", "0.9045")
    assert tool.plan(db, [_row("Salt", "2.20", "lb", "1.99", "lb")])[0].action == "unchanged"


def test_preview_writes_nothing(db, capsys):
    _add(db, "Butter", "lb", "1.00")
    assert tool.main([str(SHEET)]) == 0
    db.expire_all()
    assert db.query(Ingredient).count() == 1
    assert "Preview only" in capsys.readouterr().out


def test_the_october_sheet_loads_cleanly_into_an_empty_list(db):
    rows = tool.read_sheet(SHEET)
    changes = tool.plan(db, rows)
    assert len(rows) == 60
    assert {c.action for c in changes} == {"add"}
    by_name = {c.row.name: c for c in changes}
    # Spot checks against the sheet's own "Price per Unit" column.
    assert by_name["Eggs (whole)"].new_price == Decimal("0.2889")
    assert by_name["Cocoa powder"].new_price == Decimal("13.0000")
    # Handwritten corrections win over the printed figure.
    assert by_name["Margarine (bulk)"].new_price == Decimal("3.5000")
    assert by_name["Whipping cream (whip topping)"].new_price == Decimal("6.0000")
