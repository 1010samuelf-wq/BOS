import { describe, expect, it } from "vitest";

import type { ScannedOrder } from "../api/types";
import { draftTotal, validateDraft } from "../order/orderDraft";
import { draftFromScan, unmatchedCount, validTotal } from "./scanDraft";

const order = (over: Partial<ScannedOrder> = {}): ScannedOrder => ({
  customer_name: "Mrs. Cohen", customer_phone: "514-555-0100",
  needed_for_date: "2026-10-20", needed_for_time: "09:30", fulfillment: "pickup",
  delivery_name: "", delivery_address: "", payment_method: "", card_message: "Mazel tov", notes: "nut-free", items: [], ...over,
});

describe("a scanned order as a New Order draft", () => {
  it("carries the customer, date, time and notes", () => {
    const d = draftFromScan(order());
    expect([d.clientName, d.clientPhone, d.neededFor, d.cardMessage, d.generalNotes]).toEqual([
      "Mrs. Cohen", "514-555-0100", "2026-10-20T09:30", "Mazel tov", "nut-free",
    ]);
    expect(d.fulfillment).toBe("pickup");
  });

  it("keeps a date with no time as a date", () => {
    expect(draftFromScan(order({ needed_for_time: "" })).neededFor).toBe("2026-10-20");
    expect(draftFromScan(order({ needed_for_date: "", needed_for_time: "" })).neededFor).toBeNull();
  });

  it("only keeps an address for a delivery", () => {
    expect(draftFromScan(order({ fulfillment: "delivery", delivery_address: "1 Main" })).deliveryAddress).toBe("1 Main");
    expect(draftFromScan(order({ fulfillment: "pickup", delivery_address: "1 Main" })).deliveryAddress).toBe("");
  });

  it("uses the catalog product and price for a matched line, the written price if there was one", () => {
    const d = draftFromScan(order({ items: [
      { product_id: 7, product_name: "Chocolate Babka", catalog_price: "18.00", written_as: "choc babka", quantity: 2, unit_price: "", note: "" },
      { product_id: 7, product_name: "Chocolate Babka", catalog_price: "18.00", written_as: "babka", quantity: 1, unit_price: "16.00", note: "" },
    ] }));
    expect(d.lines.map((l) => [l.product_id, l.product_name, l.unit_price, l.quantity])).toEqual([
      [7, "Chocolate Babka", "18.00", 2],
      [7, "Chocolate Babka", "16.00", 1],
    ]);
    expect(d.lines[0].note).toBe('written: "choc babka"');
  });

  it("keeps an unmatched line as a custom item with the words as written", () => {
    const o = order({ items: [
      { product_id: null, product_name: null, catalog_price: null, written_as: "mystery tray", quantity: 1, unit_price: "35", note: "blue" },
    ] });
    const d = draftFromScan(o);
    expect(d.lines[0]).toMatchObject({ product_id: null, product_name: "mystery tray", unit_price: "35.00", priceNeeded: false, note: "blue" });
    expect(unmatchedCount(o)).toBe(1);
  });

  /** The bug: "12 minis" — no product match, nothing in the price column —
   *  came through with an empty price, and the New Order screen crashed
   *  parsing it. Every line must carry a parseable price. */
  it("gives a line with no price anywhere a valid 0.00 and flags it", () => {
    const d = draftFromScan(order({ items: [
      { product_id: null, product_name: null, catalog_price: null, written_as: "minis", quantity: 12, unit_price: "", note: "" },
    ] }));
    expect(d.lines[0]).toMatchObject({ product_name: "minis", unit_price: "0.00", priceNeeded: true, quantity: 12 });
    expect(() => draftTotal(d)).not.toThrow();
    expect(validateDraft({ ...d, clientName: "Fleischman" })).toContain('Set a price for "minis".');
  });

  it("carries who it's delivered to and how they'll pay, as pay-later", () => {
    const d = draftFromScan(order({ fulfillment: "delivery", delivery_name: "Brull", payment_method: "card" }));
    expect([d.fulfillment, d.deliveryName, d.paymentTiming, d.paymentMethod, d.expectedPaymentMethod])
      .toEqual(["delivery", "Brull", "later", null, "card"]);
  });
});

describe("an invoice total", () => {
  it("must be a positive amount", () => {
    expect(validTotal("1234.50")).toBe(true);
    expect(validTotal("12")).toBe(true);
    expect(validTotal("")).toBe(false);
    expect(validTotal("0")).toBe(false);
    expect(validTotal("1,234")).toBe(false);
  });
});
