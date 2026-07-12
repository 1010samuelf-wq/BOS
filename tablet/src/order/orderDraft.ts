// Pure order-draft logic (no React, no fetch) so the core POS flow —
// add item via search → set quantity → build submit payload — is unit-testable
// (spec §10 smoke test). The screen is a thin view over these functions.

import type {
  FulfillmentType,
  OrderCreatePayload,
  PaymentMethod,
  PaymentTiming,
  Product,
} from "../api/types";
import { fromCents, toCents } from "./money";

export interface DraftLine {
  product_id: number;
  product_name: string;
  unit_price: string; // decimal string from the API
  quantity: number;
  note: string;
}

export interface Draft {
  clientName: string;
  clientPhone: string;
  neededFor: string | null; // ISO datetime
  fulfillment: FulfillmentType;
  deliveryPrice: string; // manual entry; only meaningful for delivery
  deliveryAddress: string;
  deliveryName: string; // recipient name; only meaningful for delivery
  cardMessage: string;
  paymentTiming: PaymentTiming;
  paymentMethod: PaymentMethod | null;
  cardPaymentNote: string; // from the Card popup modal
  generalNotes: string[];
  lines: DraftLine[];
  idempotencyKey: string; // fixed at draft creation → resubmits dedupe (§2A)
}

export function newIdempotencyKey(): string {
  // RFC4122-ish v4, no crypto dependency (RN Math.random is fine for dedup ids).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function emptyDraft(): Draft {
  return {
    clientName: "",
    clientPhone: "",
    neededFor: null,
    fulfillment: "pickup",
    deliveryPrice: "",
    deliveryAddress: "",
    deliveryName: "",
    cardMessage: "",
    paymentTiming: "now",
    paymentMethod: null,
    cardPaymentNote: "",
    generalNotes: [],
    lines: [],
    idempotencyKey: newIdempotencyKey(),
  };
}

// ---- line operations --------------------------------------------------------
export function addProduct(draft: Draft, product: Product): Draft {
  // Same product tapped again bumps quantity instead of duplicating the line.
  const existing = draft.lines.findIndex((l) => l.product_id === product.id);
  if (existing >= 0) return setQuantity(draft, existing, draft.lines[existing].quantity + 1);
  return {
    ...draft,
    lines: [
      ...draft.lines,
      {
        product_id: product.id,
        product_name: product.name,
        unit_price: product.price,
        quantity: 1,
        note: "",
      },
    ],
  };
}

export function setQuantity(draft: Draft, index: number, quantity: number): Draft {
  const q = Math.max(1, Math.floor(quantity)); // typed or +/- stepped; never <1
  const lines = draft.lines.map((l, i) => (i === index ? { ...l, quantity: q } : l));
  return { ...draft, lines };
}

export function setLineNote(draft: Draft, index: number, note: string): Draft {
  const lines = draft.lines.map((l, i) => (i === index ? { ...l, note } : l));
  return { ...draft, lines };
}

export function removeLine(draft: Draft, index: number): Draft {
  return { ...draft, lines: draft.lines.filter((_, i) => i !== index) };
}

// ---- totals -----------------------------------------------------------------
export function lineTotal(line: DraftLine): string {
  return fromCents(toCents(line.unit_price) * line.quantity);
}

export function draftTotal(draft: Draft): string {
  let cents = draft.lines.reduce((sum, l) => sum + toCents(l.unit_price) * l.quantity, 0);
  if (draft.fulfillment === "delivery" && draft.deliveryPrice.trim() !== "") {
    cents += toCents(draft.deliveryPrice);
  }
  return fromCents(cents);
}

// ---- validation + payload ---------------------------------------------------
export function validateDraft(draft: Draft): string[] {
  const problems: string[] = [];
  if (!draft.clientName.trim()) problems.push("Client name is required.");
  if (draft.lines.length === 0) problems.push("Add at least one item.");
  if (draft.fulfillment === "delivery" && !draft.deliveryAddress.trim())
    problems.push("Delivery address is required for delivery orders.");
  if (draft.paymentTiming === "now" && !draft.paymentMethod)
    problems.push("Choose a payment method.");
  if (draft.deliveryPrice.trim() !== "" && !/^\d+(\.\d{1,2})?$/.test(draft.deliveryPrice.trim()))
    problems.push("Delivery price must be a number like 5 or 5.50.");
  return problems;
}

export function buildPayload(draft: Draft): OrderCreatePayload {
  const notes: OrderCreatePayload["notes"] = draft.generalNotes
    .filter((t) => t.trim())
    .map((t) => ({ text: t.trim(), type: "general" as const }));
  // Card popup note is saved as a payment-type note with its own done checkbox (§2A).
  if (draft.paymentMethod === "card" && draft.cardPaymentNote.trim()) {
    notes.push({ text: draft.cardPaymentNote.trim(), type: "payment" });
  }

  const isDelivery = draft.fulfillment === "delivery";
  return {
    idempotency_key: draft.idempotencyKey,
    client_name: draft.clientName.trim(),
    client_phone: draft.clientPhone.trim() || null,
    needed_for_date: draft.neededFor,
    fulfillment_type: draft.fulfillment,
    delivery_price:
      isDelivery && draft.deliveryPrice.trim() !== "" ? draft.deliveryPrice.trim() : null,
    delivery_address: isDelivery ? draft.deliveryAddress.trim() : null,
    delivery_name: isDelivery && draft.deliveryName.trim() !== "" ? draft.deliveryName.trim() : null,
    card_message: draft.cardMessage.trim() || null,
    payment_timing: draft.paymentTiming,
    // Backend rejects a method on pay-later orders — it's captured at mark-paid.
    payment_method: draft.paymentTiming === "now" ? draft.paymentMethod : null,
    items: draft.lines.map((l) => ({
      product_id: l.product_id,
      quantity: l.quantity,
      note: l.note.trim() || null,
    })),
    notes,
  };
}
