"""Product photo uploads to Tigris (S3-compatible) object storage.

Bucket is public-read (`fly storage update --public`), so the returned URL is
directly browser-loadable — no signing needed. Credentials/endpoint come from
the AWS_* env vars Fly set automatically when the bucket was provisioned
(`fly storage create`); boto3 picks those up on its own, no extra config.
"""

import os
import uuid

import boto3

from app.core.errors import bad_request

_ALLOWED_CONTENT_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
_MAX_BYTES = 5 * 1024 * 1024  # 5 MB — a phone/PC product photo, not a raw file


def _looks_like(ext: str, data: bytes) -> bool:
    if ext == "jpg":
        return data[:3] == b"\xff\xd8\xff"
    if ext == "png":
        return data[:8] == b"\x89PNG\r\n\x1a\n"
    return data[:4] == b"RIFF" and data[8:12] == b"WEBP"


def _client():
    return boto3.client("s3")


def _bucket_name() -> str:
    name = os.environ.get("BUCKET_NAME")
    if not name:
        raise RuntimeError("BUCKET_NAME is not set — Tigris storage not provisioned.")
    return name


def _public_url(bucket: str, key: str) -> str:
    return f"https://{bucket}.fly.storage.tigris.dev/{key}"


def upload_product_photo(product_id: int, content_type: str, data: bytes) -> str:
    """Upload one product photo; returns its public URL."""
    return _upload(f"products/{product_id}-{uuid.uuid4().hex}", content_type, data)


def upload_inbox_photo(content_type: str, data: bytes) -> str:
    """Upload a photo not yet matched to a product; returns its public URL.

    The URL stays valid after it's assigned — assigning only records it in the
    product's gallery — so the key doesn't need to name a product.
    """
    return _upload(f"inbox/{uuid.uuid4().hex}", content_type, data)


def _upload(key_stem: str, content_type: str, data: bytes) -> str:
    ext = _ALLOWED_CONTENT_TYPES.get(content_type)
    if ext is None:
        raise bad_request(
            "Only JPEG, PNG, or WEBP images are accepted.", code="unsupported_photo_type"
        )
    if len(data) > _MAX_BYTES:
        raise bad_request("Photo must be under 5 MB.", code="photo_too_large")
    # The content type is whatever the browser guessed from the file name, so
    # a renamed text file arrives as image/jpeg. Check the bytes, or it goes
    # up and shows as a broken image on the website.
    if not _looks_like(ext, data):
        raise bad_request(
            "That file isn't a readable JPEG, PNG, or WEBP image.", code="unsupported_photo_type"
        )

    bucket = _bucket_name()
    key = f"{key_stem}.{ext}"
    _client().put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)
    return _public_url(bucket, key)
