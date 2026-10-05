// Pure order-draft logic shared by the New Order screen — cents-based money, no
// float drift, idempotency key fixed per draft so a retried submit can't
// double-create. Mirrors the tablet's src/order/orderDraft.ts.

import type {
  FulfillmentType,
  Order,
  OrderCreatePayload,
  OrderUpdatePayload,
  PaymentMethod,
  PaymentTiming,
  Product,
} from "../api/types";

export function toCents(price: string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(price.trim());
  if (!m) throw new Error(`Bad money value: ${price}`);
  const [, sign, whole, frac = ""] = m;
  const cents = parseInt(whole, 10) * 100 + parseInt(frac.padEnd(2, "0") || "0", 10);
  return sign === "-" ? -cents : cents;
}
export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const a = Math.abs(cents);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

export interface DraftLine {
  product_id: number | null; // null = a custom, not-in-catalog item
  product_name: string;
  unit_price: string;
  quantity: number;
  note: string;
  saveAsProduct?: boolean; // only meaningful when product_id is null
}
export interface Draft {
  clientName: string;
  /** Who the order is for when someone orders on another's behalf. */
  forWhom: string;
  clientPhone: string;
  neededFor: string | null;
  fulfillment: FulfillmentType;
  deliveryPrice: string;
  deliveryAddress: string;
  deliveryName: string;
  cardMessage: string;
  paymentTiming: PaymentTiming;
  paymentMethod: PaymentMethod | null;
  /** What they said they'd pay with — a pay-later note, not a claim of payment. */
  expectedPaymentMethod: PaymentMethod | null;
  /** Money taken at the counter now, when it isn't the whole total: "$100 now,
   *  $300 on collection". A fixed amount, which is how the shop quotes it.
   *  Blank means nothing was taken. Pay-later only — paying now settles it all. */
  deposit: string;
  cardPaymentNote: string;
  generalNotes: string;
  lines: DraftLine[];
  idempotencyKey: string;
}

export function newIdempotencyKey(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function emptyDraft(): Draft {
  return {
    clientName: "",
    forWhom: "",
    clientPhone: "",
    neededFor: null,
    fulfillment: "pickup",
    deliveryPrice: "",
    deliveryAddress: "",
    deliveryName: "",
    cardMessage: "",
    paymentTiming: "now",
    paymentMethod: null,
    expectedPaymentMethod: null,
    deposit: "",
    cardPaymentNote: "",
    generalNotes: "",
    lines: [],
    idempotencyKey: newIdempotencyKey(),
  };
}

export function addProduct(d: Draft, p: Product): Draft {
  const i = d.lines.findIndex((l) => l.product_id === p.id);
  if (i >= 0) return setQuantity(d, i, d.lines[i].quantity + 1);
  return {
    ...d,
    lines: [...d.lines, { product_id: p.id, product_name: p.name, unit_price: p.price, quantity: 1, note: "" }],
  };
}
export function addCustomItem(d: Draft, name: string, price: string, saveAsProduct: boolean): Draft {
  return {
    ...d,
    lines: [
      ...d.lines,
      { product_id: null, product_name: name, unit_price: price, quantity: 1, note: "", saveAsProduct },
    ],
  };
}
export function setQuantity(d: Draft, i: number, q: number): Draft {
  const qty = Math.max(1, Math.floor(q));
  return { ...d, lines: d.lines.map((l, idx) => (idx === i ? { ...l, quantity: qty } : l)) };
}
export function setLineNote(d: Draft, i: number, note: string): Draft {
  return { ...d, lines: d.lines.map((l, idx) => (idx === i ? { ...l, note } : l)) };
}
export function removeLine(d: Draft, i: number): Draft {
  return { ...d, lines: d.lines.filter((_, idx) => idx !== i) };
}
export function lineTotal(l: DraftLine): string {
  return fromCents(toCents(l.unit_price) * l.quantity);
}
export function draftTotal(d: Draft): string {
  let c = d.lines.reduce((s, l) => s + toCents(l.unit_price) * l.quantity, 0);
  if (d.fulfillment === "delivery" && d.deliveryPrice.trim() !== "") c += toCents(d.deliveryPrice);
  return fromCents(c);
}

/** Is this deposit enterable as money, and does it leave something to collect?
 *
 * A deposit for the whole total is accepted (it's simply full payment), but a
 * deposit *larger* than the total is a typo — there's no refund concept to
 * absorb it, and banking it would overstate the day's takings. */
export function depositProblem(d: Draft): string | null {
  const text = d.deposit.trim();
  if (text === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return "Deposit must be an amount like 100 or 100.50.";
  if (Number(text) <= 0) return "A deposit has to be more than zero.";
  if (toCents(text) > toCents(draftTotal(d))) return "Deposit is more than the order total.";
  return null;
}

/** What's still owed after the deposit, or null when there's nothing to show.
 *
 * Null rather than "0.00" for the three cases where a balance line would be
 * noise or a lie: no deposit typed, a deposit that isn't a number yet (someone
 * is mid-keystroke), and a deposit covering the whole total — that's just
 * payment in full, not a split. */
export function balanceAfterDeposit(d: Draft): string | null {
  const text = d.deposit.trim();
  if (text === "" || !/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const left = toCents(draftTotal(d)) - toCents(text);
  return left > 0 ? fromCents(left) : null;
}

export function validateDraft(d: Draft): string[] {
  const p: string[] = [];
  if (!d.clientName.trim()) p.push("Client name is required.");
  if (d.lines.length === 0) p.push("Add at least one item.");
  if (d.fulfillment === "delivery" && !d.deliveryAddress.trim())
    p.push("Delivery address is required for delivery orders.");
  if (d.paymentTiming === "now" && !d.paymentMethod) p.push("Choose a payment method.");
  const deposit = depositProblem(d);
  if (deposit) p.push(deposit);
  if (d.deliveryPrice.trim() !== "" && !/^\d+(\.\d{1,2})?$/.test(d.deliveryPrice.trim()))
    p.push("Delivery price must be a number like 5 or 5.50.");
  return p;
}

// Editing an existing order never touches payment_timing/payment_method (those
// have their own flow — mark-paid), so it skips that one check from validateDraft.
export function validateEditDraft(d: Draft): string[] {
  const p: string[] = [];
  if (!d.clientName.trim()) p.push("Client name is required.");
  if (d.lines.length === 0) p.push("Add at least one item.");
  if (d.fulfillment === "delivery" && !d.deliveryAddress.trim())
    p.push("Delivery address is required for delivery orders.");
  if (d.deliveryPrice.trim() !== "" && !/^\d+(\.\d{1,2})?$/.test(d.deliveryPrice.trim()))
    p.push("Delivery price must be a number like 5 or 5.50.");
  return p;
}

// An existing order's items are always real catalog products (a custom item
// gets turned into one at creation, per app/services/order.py::_build_items),
// so every line round-trips through product_id — no custom-item branch needed.
export function draftFromOrder(o: Order): Draft {
  return {
    clientName: o.client_name,
    forWhom: o.for_whom ?? "",
    clientPhone: o.client_phone ?? "",
    neededFor: o.needed_for_date,
    fulfillment: o.fulfillment_type,
    deliveryPrice: o.delivery_price ?? "",
    deliveryAddress: o.delivery_address ?? "",
    deliveryName: o.delivery_name ?? "",
    cardMessage: o.card_message ?? "",
    paymentTiming: o.payment_timing,
    paymentMethod: o.payment_method,
    // Editing an order never re-takes a deposit; payments are managed on their
    // own panel, where each one keeps the date it actually arrived.
    deposit: "",
    expectedPaymentMethod: o.expected_payment_method,
    cardPaymentNote: "",
    generalNotes: "",
    lines: o.items.map((i) => ({
      product_id: i.product_id,
      product_name: i.product_name,
      unit_price: i.unit_price,
      quantity: i.quantity,
      note: i.note ?? "",
    })),
    idempotencyKey: newIdempotencyKey(), // unused by the update payload; kept so Draft stays one shape
  };
}

export function buildUpdatePayload(d: Draft): OrderUpdatePayload {
  const isDelivery = d.fulfillment === "delivery";
  return {
    client_name: d.clientName.trim(),
    for_whom: d.forWhom.trim() || null,
    client_phone: d.clientPhone.trim() || null,
    needed_for_date: d.neededFor,
    fulfillment_type: d.fulfillment,
    delivery_price: isDelivery && d.deliveryPrice.trim() !== "" ? d.deliveryPrice.trim() : null,
    delivery_address: isDelivery ? d.deliveryAddress.trim() : null,
    delivery_name: isDelivery ? d.deliveryName.trim() || null : null,
    card_message: d.cardMessage.trim() || null,
    items: d.lines.map((l) =>
      l.product_id !== null
        ? { product_id: l.product_id, quantity: l.quantity, note: l.note.trim() || null }
        : {
            custom_name: l.product_name.trim(),
            custom_price: l.unit_price,
            save_as_product: !!l.saveAsProduct,
            quantity: l.quantity,
            note: l.note.trim() || null,
          },
    ),
  };
}

export function buildPayload(d: Draft): OrderCreatePayload {
  const notes: OrderCreatePayload["notes"] = d.generalNotes
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({ text, type: "general" as const }));
  if (d.paymentMethod === "card" && d.cardPaymentNote.trim()) {
    notes.push({ text: d.cardPaymentNote.trim(), type: "payment" });
  }
  const isDelivery = d.fulfillment === "delivery";
  return {
    idempotency_key: d.idempotencyKey,
    client_name: d.clientName.trim(),
    for_whom: d.forWhom.trim() || null,
    client_phone: d.clientPhone.trim() || null,
    needed_for_date: d.neededFor,
    fulfillment_type: d.fulfillment,
    delivery_price: isDelivery && d.deliveryPrice.trim() !== "" ? d.deliveryPrice.trim() : null,
    delivery_address: isDelivery ? d.deliveryAddress.trim() : null,
    delivery_name: isDelivery ? d.deliveryName.trim() || null : null,
    card_message: d.cardMessage.trim() || null,
    payment_timing: d.paymentTiming,
    payment_method: d.paymentTiming === "now" ? d.paymentMethod : null,
    // Only meaningful on a pay-later order; paying now records the real thing.
    expected_payment_method: d.paymentTiming === "later" ? d.expectedPaymentMethod : null,
    // Same reason: a deposit is a part-payment towards a balance, so it only
    // makes sense when the rest is still to come. The server rejects both at
    // once rather than guessing which was meant.
    deposit: d.paymentTiming === "later" && d.deposit.trim() !== "" ? d.deposit.trim() : null,
    items: d.lines.map((l) =>
      l.product_id !== null
        ? { product_id: l.product_id, quantity: l.quantity, note: l.note.trim() || null }
        : {
            custom_name: l.product_name.trim(),
            custom_price: l.unit_price,
            save_as_product: !!l.saveAsProduct,
            quantity: l.quantity,
            note: l.note.trim() || null,
          },
    ),
    notes,
  };
}
