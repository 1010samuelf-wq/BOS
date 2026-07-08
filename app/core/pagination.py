"""Shared pagination for list endpoints (spec §4)."""

from __future__ import annotations

from typing import Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel

T = TypeVar("T")


class PageParams:
    """Query-param dependency: ``?limit=&offset=``."""

    def __init__(
        self,
        limit: int = Query(50, ge=1, le=200),
        offset: int = Query(0, ge=0),
    ):
        self.limit = limit
        self.offset = offset


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int
