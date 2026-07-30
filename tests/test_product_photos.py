"""Product photo upload (§2I) — stored in Tigris object storage, gated by the
`settings` section same as other catalog writes. The S3 client is mocked so
the suite never makes a real network call.
"""

import io

from app.services import photos as photos_service


class _FakeS3Client:
    def __init__(self):
        self.calls = []

    def put_object(self, Bucket, Key, Body, ContentType):
        self.calls.append({"Bucket": Bucket, "Key": Key, "Body": Body, "ContentType": ContentType})


def test_upload_photo_sets_product_url(client, make_product, monkeypatch):
    monkeypatch.setenv("BUCKET_NAME", "test-bucket")
    fake = _FakeS3Client()
    monkeypatch.setattr(photos_service, "_client", lambda: fake)

    product = make_product(name="Croissant")
    r = client.post(
        f"/api/v1/products/{product['id']}/photo",
        files={"file": ("photo.jpg", io.BytesIO(b"fake-jpeg-bytes"), "image/jpeg")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["photo_url"].startswith("https://test-bucket.fly.storage.tigris.dev/products/")
    assert len(fake.calls) == 1
    assert fake.calls[0]["ContentType"] == "image/jpeg"


def test_upload_rejects_bad_content_type(client, make_product, monkeypatch):
    monkeypatch.setenv("BUCKET_NAME", "test-bucket")
    monkeypatch.setattr(photos_service, "_client", lambda: _FakeS3Client())

    product = make_product(name="Baguette")
    r = client.post(
        f"/api/v1/products/{product['id']}/photo",
        files={"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "unsupported_photo_type"


def test_upload_requires_settings_section(client, make_product, make_user, monkeypatch):
    monkeypatch.setenv("BUCKET_NAME", "test-bucket")
    monkeypatch.setattr(photos_service, "_client", lambda: _FakeS3Client())

    product = make_product(name="Muffin")
    _, _, cashier = make_user("nora", "cashier")
    r = cashier.post(
        f"/api/v1/products/{product['id']}/photo",
        files={"file": ("photo.png", io.BytesIO(b"fake-png"), "image/png")},
    )
    assert r.status_code == 403


def test_upload_unknown_product_404s(client, monkeypatch):
    monkeypatch.setenv("BUCKET_NAME", "test-bucket")
    monkeypatch.setattr(photos_service, "_client", lambda: _FakeS3Client())

    r = client.post(
        "/api/v1/products/999999/photo",
        files={"file": ("photo.png", io.BytesIO(b"fake-png"), "image/png")},
    )
    assert r.status_code == 404
