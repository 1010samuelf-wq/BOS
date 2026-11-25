// The easy app's basket and the order it becomes. Plain functions, so the
// money and the payload can be tested without rendering a screen.

import type { OrderCreatePayload, PaymentMethod, Product } from "../api/types";

export interface CartLine {
  product: Product;
  quantity: number;
}

export type Cart = CartLine[];

export function add(cart: Cart, product: Product): Cart {
  const found = cart.find((l) => l.product.id === product.id);
  if (found) return cart.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l));
  return [...cart, { product, quantity: 1 }];
}

/** One fewer; at zero the line goes. */
export function takeOne(cart: Cart, productId: number): Cart {
  return cart
    .map((l) => (l.product.id === productId ? { ...l, quantity: l.quantity - 1 } : l))
    .filter((l) => l.quantity > 0);
}

export function count(cart: Cart): number {
  return cart.reduce((n, l) => n + l.quantity, 0);
}

/** In cents, so 0.1 + 0.2 never shows up on a customer's total. */
export function totalCents(cart: Cart): number {
  return cart.reduce((sum, l) => sum + Math.round(Number(l.product.price) * 100) * l.quantity, 0);
}

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export type When = "today" | "tomorrow" | string; // or a yyyy-mm-dd
export type Paying = "cash" | "card" | "later";

export interface Customer {
  name: string;
  phone: string;
  when: When;
  delivery: boolean;
  address: string;
  paying: Paying;
  /** Paying later: how they said they'll pay, so "Paid" records it without asking. */
  expect: PaymentMethod | null;
}

/** yyyy-mm-dd in the tablet's own clock: "today" is the shop's today. */
export function dayOf(when: When, now = new Date()): string {
  const d = new Date(now);
  if (when === "tomorrow") d.setDate(d.getDate() + 1);
  else if (when !== "today") return when;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** What's still missing, in words for the person, or null when it can go. */
export function missing(cart: Cart, c: Customer): string | null {
  if (cart.length === 0) return "Pick at least one thing to order.";
  if (!c.name.trim()) return "Type the customer's name.";
  if (c.delivery && !c.address.trim()) return "Type the delivery address.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayOf(c.when))) return "Pick the day.";
  return null;
}

export function toPayload(cart: Cart, c: Customer, idempotencyKey: string): OrderCreatePayload {
  const paidNow = c.paying !== "later";
  return {
    idempotency_key: idempotencyKey,
    client_name: c.name.trim(),
    client_phone: c.phone.trim() || null,
    needed_for_date: dayOf(c.when),
    fulfillment_type: c.delivery ? "delivery" : "pickup",
    delivery_address: c.delivery ? c.address.trim() : null,
    payment_timing: paidNow ? "now" : "later",
    payment_method: paidNow ? (c.paying as PaymentMethod) : null,
    expected_payment_method: paidNow ? null : c.expect,
    items: cart.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
    notes: [],
  };
}

/** A picture for a product with no photo yet, from its category. */
export function emojiFor(category: string | null): string {
  const c = (category ?? "").toLowerCase();
  if (c.includes("cake")) return "🎂";
  if (c.includes("bread") || c.includes("challah")) return "🍞";
  if (c.includes("pastr") || c.includes("croissant")) return "🥐";
  if (c.includes("cookie")) return "🍪";
  if (c.includes("platter") || c.includes("tray")) return "🍱";
  if (c.includes("pie") || c.includes("tart")) return "🥧";
  if (c.includes("donut") || c.includes("doughnut")) return "🍩";
  return "🧁";
}
