import { describe, expect, it } from "vitest";

import type { Product, ScannedItem, ScannedOrder } from "../api/types";
import { orderFromScan } from "./scanned";

const product = (id: number, name: string): Product => ({ id, name, price: "10.00", category: null }) as Product;

const item = (over: Partial<ScannedItem>): ScannedItem => ({
  product_id: null, product_name: null, catalog_price: null, written_as: "", quantity: 1, unit_price: "", note: "", ...over,
});

const scan = (over: Partial<ScannedOrder>): ScannedOrder => ({
  customer_name: "Mrs Klein", customer_phone: "514 555 0199", needed_for_date: "2026-12-03", needed_for_time: "",
  fulfillment: "pickup", delivery_name: "", delivery_address: "", payment_method: "", card_message: "", notes: "",
  items: [], ...over,
});

describe("a scanned order form", () => {
  const products = [product(1, "Challah"), product(2, "Babka")];

  it("fills the basket with what matched and lists what didn't", () => {
    const start = orderFromScan(scan({
      items: [
        item({ product_id: 1, written_as: "challa", quantity: 2 }),
        item({ product_id: 2, written_as: "babka", quantity: 1 }),
        item({ product_id: 1, written_as: "challah", quantity: 1 }),
        item({ written_as: "rainbow cookies", quantity: 3 }),
        item({ product_id: 99, written_as: "retired thing" }),
      ],
    }), products);
    expect(start.cart.map((l) => [l.product.name, l.quantity])).toEqual([["Challah", 3], ["Babka", 1]]);
    expect(start.unmatched).toEqual(["3× rainbow cookies", "1× retired thing"]);
  });

  it("carries the customer over, as pay later with the ticked method", () => {
    const start = orderFromScan(scan({ fulfillment: "delivery", delivery_address: "5 Elm", payment_method: "cash" }), products);
    expect(start.customer).toEqual({
      name: "Mrs Klein", phone: "514 555 0199", when: "2026-12-03",
      delivery: true, address: "5 Elm", paying: "later", expect: "cash",
    });
  });

  it("falls back to today when no date was read", () => {
    expect(orderFromScan(scan({ needed_for_date: "" }), products).customer.when).toBe("today");
  });
});
