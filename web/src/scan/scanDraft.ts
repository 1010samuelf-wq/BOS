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
    deliveryAddress: o.fulfillment === "delivery" ? o.delivery_address : "",
    cardMessage: o.card_message,
    generalNotes: o.notes,
    lines: o.items.map((it) => ({
      product_id: it.product_id,
      product_name: it.product_name ?? it.written_as,
      unit_price: it.unit_price || it.catalog_price || "",
      quantity: it.quantity,
      // Keep what was actually written next to a matched product, so the
      // person checking can see why it was matched.
      note: [it.product_id && it.written_as ? `written: "${it.written_as}"` : "", it.note]
        .filter(Boolean)
        .join(" — "),
    })),
  };
}

/** Lines the AI couldn't place in the catalog — worth a second look. */
export function unmatchedCount(o: ScannedOrder): number {
  return o.items.filter((i) => i.product_id === null).length;
}

/** "1234.5" → valid; "", "abc", "-3" → not. Totals must be positive to save. */
export function validTotal(text: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(text.trim()) && Number(text) > 0;
}
