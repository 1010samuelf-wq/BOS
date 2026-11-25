// Turning a scanned order form into the easy app's basket and customer.
// The reader only proposes: the result opens in the normal New order screen,
// where a person checks it and presses Save.

import type { Product, ScannedOrder } from "../api/types";
import type { Cart, Customer } from "./cart";

export interface OrderStart {
  cart: Cart;
  customer: Customer;
  /** What was written but isn't a product we sell, for the person to add by hand. */
  unmatched: string[];
}

export function orderFromScan(scan: ScannedOrder, products: Product[]): OrderStart {
  const byId = new Map(products.map((p) => [p.id, p]));
  const cart: Cart = [];
  const unmatched: string[] = [];
  for (const item of scan.items) {
    const product = item.product_id != null ? byId.get(item.product_id) : undefined;
    const quantity = Math.max(1, Math.round(item.quantity || 1));
    if (!product) {
      unmatched.push(`${quantity}× ${item.written_as || item.product_name || "?"}`);
      continue;
    }
    const line = cart.find((l) => l.product.id === product.id);
    if (line) line.quantity += quantity;
    else cart.push({ product, quantity });
  }
  const delivery = scan.fulfillment === "delivery";
  return {
    cart,
    unmatched,
    customer: {
      name: scan.customer_name,
      phone: scan.customer_phone,
      when: /^\d{4}-\d{2}-\d{2}$/.test(scan.needed_for_date) ? scan.needed_for_date : "today",
      delivery,
      address: delivery ? scan.delivery_address : "",
      // A ticked box on a paper form says how they'll pay, not that they have:
      // the same reading as the dashboard's scanner.
      paying: "later",
      expect: scan.payment_method || null,
    },
  };
}
