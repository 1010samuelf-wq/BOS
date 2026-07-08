"""Tiny CSV helper for report exports (spec §2A/§2D — CSV export & print).

PDF export (also mentioned in the spec) reuses the same aggregation and is
folded into the Phase 6 printing work; these endpoints emit CSV, which is what
the "Export CSV" buttons and print-to-document flows need first.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Iterable

from fastapi.responses import StreamingResponse


def csv_response(filename: str, header: list[str], rows: Iterable[list]) -> StreamingResponse:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    for row in rows:
        writer.writerow(row)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
