// Smoke tests for the core POS flow (spec §10): add item via search → set
// quantity → build the submit payload. Pure logic — no RN renderer needed.

import type { Product } from "../src/api/types";
import { fromCents, toCents } from "../src/order/money";
import {
  addProduct,
  buildPayload,
  draftTotal,
  emptyDraft,
  lineTotal,
  removeLine,
  setLineNote,
  setQuantity,
  validateDraft,
} from "../src/order/orderDraft";

const croissant: Product = {
  id: 1, name: "Croissant", price: "3.50", category: null, active: true, photo_url: null,
};
const brownie: Product = {
  id: 2, name: "Brownie", price: "2.25", category: null, active: true, photo_url: null,
};

describe("money", () => {
  it("round-trips decimal strings through cents", () => {
    expect(toCents("3.50")).toBe(350);
    expect(toCents("3.5")).toBe(350);
    expect(toCents("0.05")).toBe(5);
    expect(fromCents(350)).toBe("3.50");
    expect(fromCents(5)).toBe("0.05");
  });

  it("never drifts like floats would", () => {
    // 0.1 + 0.2 style traps: 3 × 2.25 must be exactly 6.75
    expect(fromCents(toCents("2.25") * 3)).toBe("6.75");
  });
});

describe("core POS flow: search-add → quantity → submit payload", () => {
  it("adds a searched product, steps quantity, and totals correctly", () => {
    let d = emptyDraft();
    d = addProduct(d, croissant);        // tap search result
    d = setQuantity(d, 0, 2);            // qty via +/- or typed
    expect(d.lines).toHaveLength(1);
    expect(lineTotal(d.lines[0])).toBe("7.00");
    expect(draftTotal(d)).toBe("7.00");
  });

  it("re-adding the same product bumps quantity instead of duplicating", () => {
    let d = emptyDraft();
    d = addProduct(d, croissant);
    d = addProduct(d, croissant);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].quantity).toBe(2);
  });

  it("quantity never goes below 1 and removal works", () => {
    let d = emptyDraft();
    d = addProduct(d, croissant);
    d = setQuantity(d, 0, 0);
    expect(d.lines[0].quantity).toBe(1);
    d = removeLine(d, 0);
    expect(d.lines).toHaveLength(0);
  });

  it("delivery price rolls into the total only for delivery orders", () => {
    let d = emptyDraft();
    d = addProduct(d, croissant);
    d = setQuantity(d, 0, 2);
    d = { ...d, fulfillment: "delivery", deliveryPrice: "5.00", deliveryAddress: "12 Baker St" };
    expect(draftTotal(d)).toBe("12.00");
    d = { ...d, fulfillment: "pickup" };
    expect(draftTotal(d)).toBe("7.00"); // ignored for pickup
  });

  it("builds a valid pay-now payload with a stable idempotency key", () => {
    let d = emptyDraft();
    d = addProduct(d, croissant);
    d = setQuantity(d, 0, 2);
    d = addProduct(d, brownie);
    d = setLineNote(d, 1, "no nuts");
    d = {
      ...d,
      clientName: "Jane Doe",
      clientPhone: "555-1234",
      paymentMethod: "card",
      cardPaymentNote: "terminal #442, appr 0071",
      generalNotes: ["they come and sit"],
    };

    expect(validateDraft(d)).toEqual([]);
    const payload = buildPayload(d);

    expect(payload.idempotency_key).toBe(d.idempotencyKey);
    expect(payload.idempotency_key.length).toBeGreaterThanOrEqual(8); // backend min
    expect(payload.client_name).toBe("Jane Doe");
    expect(payload.items).toEqual([
      { product_id: 1, quantity: 2, note: null },
      { product_id: 2, quantity: 1, note: "no nuts" },
    ]);
    // card popup note becomes a payment-type note with its own checkbox (§2A)
    expect(payload.notes).toEqual([
      { text: "they come and sit", type: "general" },
      { text: "terminal #442, appr 0071", type: "payment" },
    ]);
    expect(payload.payment_method).toBe("card");

    // resubmitting the same draft keeps the same key → server dedupes (§2A)
    expect(buildPayload(d).idempotency_key).toBe(payload.idempotency_key);
  });

  it("pay-later payload omits the method (captured at mark-paid instead)", () => {
    let d = emptyDraft();
    d = addProduct(d, croissant);
    d = { ...d, clientName: "Bob", paymentTiming: "later", paymentMethod: null };
    expect(validateDraft(d)).toEqual([]);
    expect(buildPayload(d).payment_method).toBeNull();
  });

  it("validation catches the §2A required fields", () => {
    let d = emptyDraft();
    expect(validateDraft(d)).toContain("Client name is required.");
    expect(validateDraft(d)).toContain("Add at least one item.");

    d = addProduct(d, croissant);
    d = { ...d, clientName: "Ann", fulfillment: "delivery", deliveryAddress: "" };
    expect(validateDraft(d)).toContain("Delivery address is required for delivery orders.");

    d = { ...d, deliveryAddress: "12 Baker St", paymentTiming: "now", paymentMethod: null };
    expect(validateDraft(d)).toContain("Choose a payment method.");
  });
});
