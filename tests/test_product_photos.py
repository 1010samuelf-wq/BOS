"""Several photos per product.

The invariant everything else depends on: `products.photo_url` always mirrors
the first photo. It stays a real column because the installed tablet binaries
read it, and tablets on the old runtime can't be updated over the air — so the
gallery is the truth and the column is a view of it that old clients still
understand.

Uploads themselves need object storage, so these drive the service layer and
the public payload rather than the multipart endpoint.
"""

import pytest

from app.services import product_photos


@pytest.fixture
def db():
    from app.database import SessionLocal

    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _add(db, product_id, *urls):
    for u in urls:
        product_photos.add_photo(db, product_id, u)
    db.commit()


def _cover(client, product_id):
    return [p for p in client.get("/api/v1/products").json() if p["id"] == product_id][0]["photo_url"]


def _public(client, name):
    return [p for p in client.get("/api/v1/public/products").json() if p["name"] == name][0]


# ---------------------------------------------------------------------------
# the cover invariant
# ---------------------------------------------------------------------------
def test_the_first_photo_becomes_the_cover(client, make_product, db):
    p = make_product(name="Babka")
    _add(db, p["id"], "https://img/one.jpg")
    assert _cover(client, p["id"]) == "https://img/one.jpg"


def test_a_second_photo_does_not_steal_the_cover(client, make_product, db):
    p = make_product(name="Babka")
    _add(db, p["id"], "https://img/one.jpg", "https://img/two.jpg")

    assert _cover(client, p["id"]) == "https://img/one.jpg"
    row = [x for x in client.get("/api/v1/products").json() if x["id"] == p["id"]][0]
    assert [ph["url"] for ph in row["photos"]] == ["https://img/one.jpg", "https://img/two.jpg"]


def test_a_photo_can_be_promoted_to_cover(client, make_product, db):
    p = make_product(name="Babka")
    _add(db, p["id"], "https://img/one.jpg", "https://img/two.jpg")
    row = [x for x in client.get("/api/v1/products").json() if x["id"] == p["id"]][0]
    second = row["photos"][1]["id"]

    r = client.post(f"/api/v1/products/{p['id']}/photos/{second}/cover")
    assert r.status_code == 200, r.text
    assert r.json()["photo_url"] == "https://img/two.jpg"
    assert [ph["url"] for ph in r.json()["photos"]] == ["https://img/two.jpg", "https://img/one.jpg"]


def test_deleting_the_cover_promotes_the_next(client, make_product, db):
    p = make_product(name="Babka")
    _add(db, p["id"], "https://img/one.jpg", "https://img/two.jpg")
    row = [x for x in client.get("/api/v1/products").json() if x["id"] == p["id"]][0]
    first = row["photos"][0]["id"]

    r = client.delete(f"/api/v1/products/{p['id']}/photos/{first}")
    assert r.status_code == 200
    assert r.json()["photo_url"] == "https://img/two.jpg"


def test_deleting_the_last_photo_clears_the_cover(client, make_product, db):
    p = make_product(name="Babka")
    _add(db, p["id"], "https://img/only.jpg")
    row = [x for x in client.get("/api/v1/products").json() if x["id"] == p["id"]][0]

    r = client.delete(f"/api/v1/products/{p['id']}/photos/{row['photos'][0]['id']}")
    assert r.json()["photo_url"] is None
    assert r.json()["photos"] == []


def test_positions_stay_contiguous_after_a_delete(client, make_product, db):
    """Otherwise repeated promote/delete leaves gaps and the order drifts."""
    p = make_product(name="Babka")
    _add(db, p["id"], "https://img/1.jpg", "https://img/2.jpg", "https://img/3.jpg")
    row = [x for x in client.get("/api/v1/products").json() if x["id"] == p["id"]][0]

    r = client.delete(f"/api/v1/products/{p['id']}/photos/{row['photos'][1]['id']}")
    assert [ph["position"] for ph in r.json()["photos"]] == [0, 1]


# ---------------------------------------------------------------------------
# limits and errors
# ---------------------------------------------------------------------------
def test_there_is_a_ceiling_on_photos(client, make_product, db):
    p = make_product(name="Babka")
    _add(db, p["id"], *[f"https://img/{i}.jpg" for i in range(product_photos.MAX_PHOTOS)])

    with pytest.raises(Exception):
        product_photos.add_photo(db, p["id"], "https://img/one-too-many.jpg")


def test_deleting_a_photo_from_the_wrong_product_is_404(client, make_product, db):
    a = make_product(name="A")
    b = make_product(name="B")
    _add(db, a["id"], "https://img/a.jpg")
    row = [x for x in client.get("/api/v1/products").json() if x["id"] == a["id"]][0]

    assert client.delete(
        f"/api/v1/products/{b['id']}/photos/{row['photos'][0]['id']}"
    ).status_code == 404


def test_managing_photos_needs_the_settings_section(make_user, client, make_product, db):
    p = make_product(name="Guarded")
    _add(db, p["id"], "https://img/a.jpg")
    row = [x for x in client.get("/api/v1/products").json() if x["id"] == p["id"]][0]
    photo_id = row["photos"][0]["id"]
    _, _, cashier = make_user("Cashier Cass", "cashier")

    assert cashier.delete(f"/api/v1/products/{p['id']}/photos/{photo_id}").status_code == 403
    assert cashier.post(f"/api/v1/products/{p['id']}/photos/{photo_id}/cover").status_code == 403


# ---------------------------------------------------------------------------
# what the website receives
# ---------------------------------------------------------------------------
def test_the_public_menu_carries_every_photo_as_a_plain_url(client, make_product, db):
    p = make_product(name="Cheesecake")
    _add(db, p["id"], "https://img/front.jpg", "https://img/side.jpg")

    public = _public(client, "Cheesecake")
    assert public["photos"] == ["https://img/front.jpg", "https://img/side.jpg"]
    # Cover first, matching the grid, so opening a product doesn't jump.
    assert public["photo_url"] == public["photos"][0]
    # Still no internal ids or flags.
    assert "show_on_menu" not in public
    assert all(isinstance(u, str) for u in public["photos"])


def test_a_product_with_no_photos_reports_an_empty_list(client, make_product):
    make_product(name="Plain")
    public = _public(client, "Plain")
    assert public["photos"] == []
    assert public["photo_url"] is None


def test_deleting_a_product_takes_its_photos(client, make_product, db):
    """The rows cascade; nothing is left pointing at a product that's gone."""
    from app.models import ProductPhoto

    p = make_product(name="Doomed")
    _add(db, p["id"], "https://img/a.jpg", "https://img/b.jpg")

    assert client.delete(f"/api/v1/products/{p['id']}").status_code == 204
    remaining = db.query(ProductPhoto).filter(ProductPhoto.product_id == p["id"]).count()
    assert remaining == 0
