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
    ext = _ALLOWED_CONTENT_TYPES.get(content_type)
    if ext is None:
        raise bad_request(
            "Only JPEG, PNG, or WEBP images are accepted.", code="unsupported_photo_type"
        )
    if len(data) > _MAX_BYTES:
        raise bad_request("Photo must be under 5 MB.", code="photo_too_large")

    bucket = _bucket_name()
    key = f"products/{product_id}-{uuid.uuid4().hex}.{ext}"
    _client().put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)
    return _public_url(bucket, key)
