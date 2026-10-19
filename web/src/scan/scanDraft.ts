// Turning what the AI read off a page into something staff can check.
// Plain functions so they're tested without rendering.

import type { ScannedOrder, ScannedShift, TimeEntry } from "../api/types";
import { emptyDraft, type Draft } from "../order/orderDraft";

/** A New Order draft from a scanned order form.
 *
 *  A line the AI matched to the catalog uses that product at its catalog
 *  price — unless the form had a price written, which wins, because that is
 *  what the customer was told. A line it couldn't match becomes a custom item
 *  with the words as written, so nothing on the page is silently dropped.
 */
export function draftFromScan(o: ScannedOrder): Draft {
  const base = emptyDraft();
  const neededFor = o.needed_for_date
    ? o.needed_for_time ? `${o.needed_for_date}T${o.needed_for_time}` : o.needed_for_date
    : null;
  return {
    ...base,
    clientName: o.customer_name,
    clientPhone: o.customer_phone,
    neededFor,
    fulfillment: o.fulfillment === "delivery" ? "delivery" : "pickup",
    deliveryName: o.fulfillment === "delivery" ? o.delivery_name : "",
    deliveryAddress: o.fulfillment === "delivery" ? o.delivery_address : "",
    // A paper order hasn't been paid at the counter: it goes in as pay-later,
    // with the ticked box as how they said they'd pay.
    paymentTiming: "later",
    paymentMethod: null,
    expectedPaymentMethod: o.payment_method || null,
    cardMessage: o.card_message,
    generalNotes: o.notes,
    lines: o.items.map((it) => {
      const price = moneyOrNull(it.unit_price) ?? moneyOrNull(it.catalog_price);
      return {
      product_id: it.product_id,
      product_name: it.product_name ?? it.written_as,
      // No price anywhere (an unmatched line with nothing in the price
      // column): 0.00 keeps the totals working, and priceNeeded stops the
      // order going in until someone sets it. An empty string here took the
      // whole New Order screen down.
      unit_price: price ?? "0.00",
      priceNeeded: price === null,
      quantity: it.quantity,
      // Keep what was actually written next to a matched product, so the
      // person checking can see why it was matched.
      note: [it.product_id && it.written_as ? `written: "${it.written_as}"` : "", it.note]
        .filter(Boolean)
        .join(" — "),
      };
    }),
  };
}

/** "18" → "18.00"; "", "abc" or null → null. */
function moneyOrNull(text: string | null | undefined): string | null {
  const t = (text ?? "").trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return `${Number(whole)}.${frac.padEnd(2, "0")}`;
}

/** Lines the AI couldn't place in the catalog — worth a second look. */
export function unmatchedCount(o: ScannedOrder): number {
  return o.items.filter((i) => i.product_id === null).length;
}

/** "1234.5" → valid; "", "abc", "-3" → not. Totals must be positive to save. */
export function validTotal(text: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(text.trim()) && Number(text) > 0;
}


// ---- timesheets ----------------------------------------------------------
export interface ShiftRow extends ScannedShift {
  include: boolean;
}

/** A shift as the API wants it: the shop's wall-clock times turned into
 *  instants in this browser's time zone — the same conversion the Time
 *  screen uses when someone adds a missed punch by hand. */
export function shiftToEntry(s: ScannedShift): { clock_in: string; clock_out: string | null } {
  return {
    clock_in: new Date(`${s.date}T${s.time_in}`).toISOString(),
    clock_out: s.time_out ? new Date(`${s.date}T${s.time_out}`).toISOString() : null,
  };
}

/** Why a row can't be saved as it stands, or null when it can. */
export function shiftProblem(s: ScannedShift): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) return "needs a date";
  if (!/^\d{2}:\d{2}$/.test(s.time_in)) return "needs a time in";
  if (s.time_out && !/^\d{2}:\d{2}$/.test(s.time_out)) return "time out isn't a time";
  if (s.time_out && s.time_out <= s.time_in) return "time out is before time in — check AM/PM";
  return null;
}

/** Does this shift overlap one already in the system? Scanning the same sheet
 *  twice would otherwise double the week's hours. */
export function overlapsExisting(s: ScannedShift, existing: TimeEntry[]): boolean {
  if (shiftProblem(s)) return false;
  const { clock_in, clock_out } = shiftToEntry(s);
  const start = Date.parse(clock_in);
  const end = clock_out ? Date.parse(clock_out) : start + 60_000;
  return existing.some((e) => {
    const eStart = Date.parse(e.clock_in);
    const eEnd = e.clock_out ? Date.parse(e.clock_out) : eStart + 60_000;
    return start < eEnd && eStart < end;
  });
}

/** Hours for the review screen, e.g. "7.75"; "" while a row is incomplete. */
export function shiftHours(s: ScannedShift): string {
  if (shiftProblem(s) || !s.time_out) return "";
  const [h1, m1] = s.time_in.split(":").map(Number);
  const [h2, m2] = s.time_out.split(":").map(Number);
  return ((h2 * 60 + m2 - (h1 * 60 + m1)) / 60).toFixed(2);
}
