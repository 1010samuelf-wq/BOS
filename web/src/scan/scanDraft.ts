// Turning what the AI read off a page into something staff can check.
// Plain functions so they're tested without rendering.

import type { ScannedOrder } from "../api/types";
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
