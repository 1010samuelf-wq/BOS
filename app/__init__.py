"""Bakery Operations System (BOS) backend — Phase 1.

Scope of this phase (per spec §8):
  - PostgreSQL schema (all tables)
  - Core Order & Inventory APIs with transactional, non-blocking stock
    deduction, idempotency keys, and row-level locking on edits.

Auth (PIN/JWT), reports, notifications feed, tasks, time tracking and the
frontends land in later phases. A lightweight `current_user` dependency
stands in for real auth so we can already record who did what.
"""

__version__ = "0.1.0"
