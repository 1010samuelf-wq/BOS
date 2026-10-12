"""The photo inbox: one person uploads a batch, another assigns each photo.

Storage is faked at the boto client, so these go through the real multipart
endpoint, the content-type and size checks, and the URL that comes back.
"""

import pytest

from app.services import photos as photos_service
from app.services import product_photos

JPEG = b"\xff\xd8\xff\xe0fake-jpeg"


class _FakeS3:
    def __init__(self):
        self.puts = []

    def put_object(self, **kw):
        self.puts.append(kw)


@pytest.fixture
def s3(monkeypatch):
    fake = _FakeS3()
    monkeypatch.setenv("BUCKET_NAME", "test-bucket")
    monkeypatch.setattr(photos_service, "_client", lambda: fake)
    return fake


def _upload(c, name="tray-1.jpg", data=JPEG, ctype="image/jpeg"):
    return c.post("/api/v1/photo-inbox", files={"file": (name, data, ctype)})


def _product(client, pid):
    return [p for p in client.get("/api/v1/products").json() if p["id"] == pid][0]


def test_a_batch_lands_in_the_inbox_oldest_first(client, s3):
    for n in ("a.jpg", "b.jpg", "c.jpg"):
        assert _upload(client, n).status_code == 201

    rows = client.get("/api/v1/photo-inbox").json()
    assert [r["filename"] for r in rows] == ["a.jpg", "b.jpg", "c.jpg"]
    assert rows[0]["uploaded_by_name"] == "admin"
    assert all(r["url"].startswith("https://test-bucket.fly.storage.tigris.dev/inbox/") for r in rows)
    assert len(s3.puts) == 3


def test_a_bad_file_is_refused_and_stores_nothing(client, s3):
    r = _upload(client, "notes.pdf", b"%PDF", "application/pdf")
    assert r.status_code == 400
    assert s3.puts == []
    assert client.get("/api/v1/photo-inbox").json() == []


def test_a_renamed_file_is_refused_by_its_contents(client, s3):
    # The browser labels by extension, so notes.txt renamed to .jpg arrives
    # as image/jpeg.
    r = _upload(client, "fake.jpg", b"just some text", "image/jpeg")
    assert r.status_code == 400
    assert s3.puts == []


def test_png_and_webp_are_accepted(client, s3):
    assert _upload(client, "a.png", b"\x89PNG\r\n\x1a\nrest", "image/png").status_code == 201
    assert _upload(client, "a.webp", b"RIFF\x00\x00\x00\x00WEBPVP8 ", "image/webp").status_code == 201


def test_assigning_moves_the_photo_onto_the_product(client, s3, make_product):
    p = make_product(name="Babka")
    photo = _upload(client).json()

    r = client.post(f"/api/v1/photo-inbox/{photo['id']}/assign", json={"product_id": p["id"]})
    assert r.status_code == 200, r.text
    assert [ph["url"] for ph in r.json()["photos"]] == [photo["url"]]
    # First photo becomes the cover, same as a direct upload.
    assert _product(client, p["id"])["photo_url"] == photo["url"]
    assert client.get("/api/v1/photo-inbox").json() == []


def test_assigning_to_a_product_with_photos_keeps_its_cover(client, s3, make_product):
    p = make_product(name="Challah")
    first = _upload(client, "1.jpg").json()
    second = _upload(client, "2.jpg").json()
    client.post(f"/api/v1/photo-inbox/{first['id']}/assign", json={"product_id": p["id"]})
    client.post(f"/api/v1/photo-inbox/{second['id']}/assign", json={"product_id": p["id"]})

    row = _product(client, p["id"])
    assert [ph["url"] for ph in row["photos"]] == [first["url"], second["url"]]
    assert row["photo_url"] == first["url"]


def test_a_full_gallery_refuses_and_the_photo_stays_in_the_inbox(client, s3, make_product):
    from app.database import SessionLocal

    p = make_product(name="Full")
    with SessionLocal() as db:
        for i in range(product_photos.MAX_PHOTOS):
            product_photos.add_photo(db, p["id"], f"https://img/{i}.jpg")
        db.commit()
    photo = _upload(client).json()

    r = client.post(f"/api/v1/photo-inbox/{photo['id']}/assign", json={"product_id": p["id"]})
    assert r.status_code == 400
    assert [x["id"] for x in client.get("/api/v1/photo-inbox").json()] == [photo["id"]]


def test_assigning_to_a_missing_product_leaves_the_photo(client, s3):
    photo = _upload(client).json()
    r = client.post(f"/api/v1/photo-inbox/{photo['id']}/assign", json={"product_id": 9999})
    assert r.status_code == 404
    assert len(client.get("/api/v1/photo-inbox").json()) == 1


def test_a_photo_can_only_be_assigned_once(client, s3, make_product):
    a = make_product(name="A")
    b = make_product(name="B")
    photo = _upload(client).json()
    client.post(f"/api/v1/photo-inbox/{photo['id']}/assign", json={"product_id": a["id"]})

    r = client.post(f"/api/v1/photo-inbox/{photo['id']}/assign", json={"product_id": b["id"]})
    assert r.status_code == 404
    assert _product(client, b["id"])["photos"] == []


def test_discarding_goes_to_the_trash_and_can_be_put_back(client, s3):
    photo = _upload(client, "blurry.jpg").json()

    assert client.delete(f"/api/v1/photo-inbox/{photo['id']}").status_code == 204
    assert client.get("/api/v1/photo-inbox").json() == []

    item = [t for t in client.get("/api/v1/trash").json() if t["kind"] == "inbox_photo"][0]
    assert "blurry.jpg" in item["label"]
    assert client.post(f"/api/v1/trash/{item['id']}/restore").status_code == 200

    back = client.get("/api/v1/photo-inbox").json()
    assert [(r["url"], r["filename"]) for r in back] == [(photo["url"], "blurry.jpg")]


def test_the_inbox_needs_the_settings_section(client, s3, make_user, make_product):
    p = make_product(name="Guarded")
    photo = _upload(client).json()
    _, _, cashier = make_user("Cashier Cass", "cashier")

    assert cashier.get("/api/v1/photo-inbox").status_code == 403
    assert _upload(cashier).status_code == 403
    assert cashier.post(
        f"/api/v1/photo-inbox/{photo['id']}/assign", json={"product_id": p["id"]}
    ).status_code == 403
    assert cashier.delete(f"/api/v1/photo-inbox/{photo['id']}").status_code == 403
