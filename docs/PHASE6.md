# Phase 6 — PDF generation (design notes & review)

Covers spec §8 step 6, re-scoped by user decision: **PDF generation only, no
server-side printer.** The server renders receipts and report PDFs; the client
hands the bytes to the tablet's own print/share sheet (or the browser).

## Decisions

1. **fpdf2, not a printer driver.** Pure-Python, no native deps (unlike
   WeasyPrint's cairo/pango) — installs cleanly on Python 3.14. Renders plain
   A4 documents. There is no ESC/POS / thermal path and no printer config; a
   "regular HP printer" is just whatever the OS print dialog offers.

2. **Two endpoints:**
   - `GET /orders/{id}/receipt` → `application/pdf` — any authenticated user
     (a cashier can print a receipt). Header from the business profile
     (falls back to "Bakery" if unset). Includes items, per-line notes,
     delivery line/address, total, payment status+method, card message, and
     general notes.
   - `GET /reports/summary/pdf` → sales report PDF, Manager+ (mirrors the CSV
     export's gating).

3. **Business profile is the header.** The kept `app_settings` row supplies
   name/address/phone. Fetched with `db.get(AppSettings, 1)` (no create-on-GET),
   so a missing profile just renders the fallback.

4. **latin-1 sanitisation.** Core fonts are latin-1 only, so all rendered text
   is `.encode("latin-1", "replace")`d — which cleanly handles French accents
   (café, crème, "Céline Dupré" all verified) and drops emoji to `?`. Separators
   use ASCII `-`, not em-dash (em-dash isn't latin-1 and rendered as `?`).
   Bundle a Unicode TTF later if emoji/non-Western text ever matters.

## Client wiring

- **Tablet** — `src/order/receipt.ts::printReceipt(orderId)` fetches the PDF
  with the auth header, writes it to the cache dir (expo-file-system), and calls
  `Print.printAsync` (expo-print) → the OS print dialog (incl. "Save as PDF" and
  any printer the tablet knows). Wired to a **"🖨 Print receipt"** button on the
  order detail. Added deps: `expo-print`, `expo-file-system`.
- **Web** — `openPdf` fetches the PDF authenticated and opens it in a new tab
  (view + browser print). Wired to an **"Export PDF"** button on Reports,
  alongside the existing CSV export.

## What was verified

- `pytest` — **70/70 green**, incl. 5 new PDF tests: receipt is a valid `%PDF`
  with the right content-type/disposition and non-trivial size; business profile
  + delivery variant; accented text doesn't crash; report PDF; Manager-only
  report vs. any-user receipt.
- **Rendered both PDFs from the live server and eyeballed them** — receipt
  (header, items, delivery, total, payment, card message, notes) and sales
  report (metrics, payment breakdown, expenses) both lay out correctly.

## Not run here

The tablet/web print wiring uses expo-print / browser Blob APIs that need a
device/browser — written and statically reviewed, not executed (no Node.js).
The **backend PDF rendering — the actual deliverable — is verified end-to-end.**
