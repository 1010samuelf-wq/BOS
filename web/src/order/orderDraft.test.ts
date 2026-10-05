import { describe, expect, it } from "vitest";

import type { Product } from "../api/types";
import {
  addCustomItem,
  addProduct,
  balanceAfterDeposit,
  buildPayload,
  depositProblem,
  draftTotal,
  emptyDraft,
  lineTotal,
  removeLine,
  setQuantity,
  validateDraft,
} from "./orderDraft";

const product = (over: Partial<Product> = {}): Product => ({
  id: 1,
  name: "Chocolate babka",
  price: "24.00",
  category: "Babka",
  active: true,
  show_on_menu: true,
  photo_url: null,
  photos: [],
  ...over,
});

/** The order total is the number a customer is charged, so the cases worth
 *  pinning are the ones where floating-point money normally goes wrong. */
describe("draft totals", () => {
  it("is zero for an empty order", () => {
    expect(draftTotal(emptyDraft())).toBe("0.00");
  });

  it("multiplies a line by its quantity", () => {
    let d = addProduct(emptyDraft(), product());
    d = setQuantity(d, 0, 3);
    expect(draftTotal(d)).toBe("72.00");
  });

  it("adds prices that a float would round wrong", () => {
    // 0.1 + 0.2 is the classic; in cents it has to come out exactly 0.30.
    let d = addProduct(emptyDraft(), product({ id: 1, price: "0.10" }));
    d = addProduct(d, product({ id: 2, name: "Other", price: "0.20" }));
    expect(draftTotal(d)).toBe("0.30");
  });

  it("keeps cents exact over a long order", () => {
    let d = emptyDraft();
    for (let i = 0; i < 10; i++) {
      d = addProduct(d, product({ id: i + 1, name: `Item ${i}`, price: "1.15" }));
    }
    expect(draftTotal(d)).toBe("11.50");
  });

  it("includes the delivery charge only on a delivery", () => {
    const base = addProduct(emptyDraft(), product());
    const pickup = { ...base, fulfillment: "pickup" as const, deliveryPrice: "8.00" };
    const delivery = { ...base, fulfillment: "delivery" as const, deliveryPrice: "8.00" };

    expect(draftTotal(pickup)).toBe("24.00");
    expect(draftTotal(delivery)).toBe("32.00");
  });

  it("survives a blank delivery charge", () => {
    const d = { ...addProduct(emptyDraft(), product()), fulfillment: "delivery" as const, deliveryPrice: "" };
    expect(draftTotal(d)).toBe("24.00");
  });

  it("prices one line on its own", () => {
    const d = setQuantity(addProduct(emptyDraft(), product({ price: "1.15" })), 0, 3);
    expect(lineTotal(d.lines[0])).toBe("3.45");
  });
});

describe("building the line list", () => {
  it("bumps the quantity instead of repeating a product", () => {
    let d = addProduct(emptyDraft(), product());
    d = addProduct(d, product());
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].quantity).toBe(2);
  });

  it("keeps custom items separate even with the same name", () => {
    let d = addCustomItem(emptyDraft(), "Special", "30.00", false);
    d = addCustomItem(d, "Special", "30.00", false);
    expect(d.lines).toHaveLength(2);
  });

  it("never lets a quantity drop below one", () => {
    const d = setQuantity(addProduct(emptyDraft(), product()), 0, 0);
    expect(d.lines[0].quantity).toBe(1);
  });

  it("removes the line that was asked for", () => {
    let d = addProduct(emptyDraft(), product({ id: 1, name: "A" }));
    d = addProduct(d, product({ id: 2, name: "B" }));
    d = removeLine(d, 0);
    expect(d.lines.map((l) => l.product_name)).toEqual(["B"]);
  });
});

describe("validation", () => {
  const ready = () => ({
    ...addProduct(emptyDraft(), product()),
    clientName: "Mrs Weiss",
    paymentTiming: "later" as const,
  });

  it("passes a complete order", () => {
    expect(validateDraft(ready())).toEqual([]);
  });

  it("wants a name", () => {
    expect(validateDraft({ ...ready(), clientName: "  " })).toContain("Client name is required.");
  });

  it("wants at least one item", () => {
    expect(validateDraft({ ...ready(), lines: [] })).toContain("Add at least one item.");
  });

  it("wants an address for a delivery", () => {
    const d = { ...ready(), fulfillment: "delivery" as const, deliveryAddress: "" };
    expect(validateDraft(d)).toContain("Delivery address is required for delivery orders.");
  });

  it("wants a method when paying now", () => {
    const d = { ...ready(), paymentTiming: "now" as const, paymentMethod: null };
    expect(validateDraft(d)).toContain("Choose a payment method.");
  });

  it("rejects a delivery charge that isn't a number", () => {
    const d = { ...ready(), fulfillment: "delivery" as const, deliveryAddress: "1 Rue X", deliveryPrice: "free" };
    expect(validateDraft(d)).toContain("Delivery price must be a number like 5 or 5.50.");
  });

  it("reports every problem at once, not just the first", () => {
    const d = { ...emptyDraft(), paymentTiming: "now" as const };
    expect(validateDraft(d).length).toBeGreaterThanOrEqual(3);
  });
});

/** The shop quotes a deposit as a fixed amount: "$100 now, $300 on
 *  collection". These pin the split the form shows and the payload it sends. */
describe("deposits", () => {
  const order = (deposit: string) => ({
    ...addProduct(emptyDraft(), product({ price: "400.00" })),
    clientName: "Mrs Weiss",
    paymentTiming: "later" as const,
    deposit,
  });

  it("shows nothing to collect when no deposit was typed", () => {
    expect(balanceAfterDeposit(order(""))).toBeNull();
  });

  it("works out what is left on collection", () => {
    expect(balanceAfterDeposit(order("100"))).toBe("300.00");
    expect(balanceAfterDeposit(order("100.50"))).toBe("299.50");
  });

  it("stays quiet mid-keystroke rather than flashing a wrong figure", () => {
    expect(balanceAfterDeposit(order("1."))).toBeNull();
    expect(balanceAfterDeposit(order("abc"))).toBeNull();
  });

  it("shows no balance when the deposit is the whole total", () => {
    // That's payment in full, not a split — a "$0.00 on collection" line
    // would be noise.
    expect(balanceAfterDeposit(order("400"))).toBeNull();
    expect(balanceAfterDeposit(order("450"))).toBeNull();
  });

  it("accepts a deposit up to the total", () => {
    expect(depositProblem(order("100"))).toBeNull();
    expect(depositProblem(order("400"))).toBeNull();
    expect(depositProblem(order(""))).toBeNull();
  });

  it("rejects a deposit bigger than the order", () => {
    // No refund concept to absorb it, so it's a typo.
    expect(depositProblem(order("500"))).toContain("more than the order total");
  });

  it("rejects something that isn't money", () => {
    expect(depositProblem(order("lots"))).toContain("amount like");
    expect(depositProblem(order("0"))).toContain("more than zero");
  });

  it("blocks submitting an order with a bad deposit", () => {
    expect(validateDraft(order("500")).length).toBeGreaterThan(0);
    expect(validateDraft(order("100"))).toEqual([]);
  });

  it("sends the deposit only on a pay-later order", () => {
    expect(buildPayload(order("100")).deposit).toBe("100");

    const payingNow = { ...order("100"), paymentTiming: "now" as const, paymentMethod: "cash" as const };
    // Paying now already settles the whole total; sending both would be
    // contradictory and the server refuses it.
    expect(buildPayload(payingNow).deposit).toBeNull();
  });

  it("sends null when nothing was taken", () => {
    expect(buildPayload(order("")).deposit).toBeNull();
  });
});
