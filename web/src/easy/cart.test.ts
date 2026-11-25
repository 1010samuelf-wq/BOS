import { describe, expect, it } from "vitest";

import type { Product } from "../api/types";
import { add, count, dayOf, dollars, emojiFor, missing, takeOne, toPayload, totalCents, type Customer } from "./cart";

const product = (id: number, price: string, category: string | null = "Cakes"): Product =>
  ({ id, name: `P${id}`, price, category, photo_url: null }) as Product;

const customer = (over: Partial<Customer> = {}): Customer => ({
  name: "Mrs Cohen", phone: "", when: "today", delivery: false, address: "", paying: "later", expect: null, ...over,
});

describe("the basket", () => {
  it("adds, counts and takes away", () => {
    let cart = add(add(add([], product(1, "3.50")), product(1, "3.50")), product(2, "10"));
    expect(count(cart)).toBe(3);
    cart = takeOne(cart, 1);
    expect(cart.map((l) => [l.product.id, l.quantity])).toEqual([[1, 1], [2, 1]]);
    cart = takeOne(cart, 1);
    expect(cart.map((l) => l.product.id)).toEqual([2]);
  });

  it("adds money in cents", () => {
    const cart = add(add(add([], product(1, "0.10")), product(2, "0.20")), product(1, "0.10"));
    expect(totalCents(cart)).toBe(40);
    expect(dollars(totalCents(cart))).toBe("$0.40");
  });
});

describe("the order it becomes", () => {
  const now = new Date(2026, 10, 30, 23, 30); // 30 Nov, late evening

  it("turns today and tomorrow into dates on the tablet's clock", () => {
    expect(dayOf("today", now)).toBe("2026-11-30");
    expect(dayOf("tomorrow", now)).toBe("2026-12-01");
    expect(dayOf("2026-12-24", now)).toBe("2026-12-24");
  });

  it("says what's missing before it can be sent", () => {
    const cart = add([], product(1, "5"));
    expect(missing([], customer())).toMatch(/Pick at least one/);
    expect(missing(cart, customer({ name: "  " }))).toMatch(/name/);
    expect(missing(cart, customer({ delivery: true }))).toMatch(/address/);
    expect(missing(cart, customer())).toBeNull();
  });

  it("builds a paid-now pickup and a pay-later delivery", () => {
    const cart = add(add([], product(7, "5")), product(7, "5"));
    const paid = toPayload(cart, customer({ paying: "cash", phone: " 514 " }), "easy-key-1");
    expect(paid).toMatchObject({
      client_name: "Mrs Cohen", client_phone: "514", fulfillment_type: "pickup",
      payment_timing: "now", payment_method: "cash", delivery_address: null,
      items: [{ product_id: 7, quantity: 2 }],
    });
    const later = toPayload(cart, customer({ delivery: true, address: "12 Main", expect: "etransfer" }), "easy-key-2");
    expect(later).toMatchObject({
      fulfillment_type: "delivery", delivery_address: "12 Main",
      payment_timing: "later", payment_method: null, expected_payment_method: "etransfer",
    });
    // Paid now: the method is the real one, and nothing is "expected".
    expect(toPayload(cart, customer({ paying: "card", expect: "cash" }), "easy-key-3")).toMatchObject({
      payment_method: "card", expected_payment_method: null,
    });
  });
});

it("finds a picture for a product with no photo", () => {
  expect(emojiFor("Birthday Cakes")).toBe("🎂");
  expect(emojiFor(null)).toBe("🧁");
});
