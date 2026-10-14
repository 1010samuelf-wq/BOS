import { describe, expect, it } from "vitest";

import type { Product } from "../api/types";
import { buildEmailHtml, buildEmailText, groupByCategory, telHref, type EmailParts } from "./buildEmail";

const product = (id: number, name: string, category: string | null, photo: string | null = null) =>
  ({ id, name, price: "12.50", category, photo_url: photo, photos: [] }) as unknown as Product;

const parts = (over: Partial<EmailParts> = {}): EmailParts => ({
  subject: "This week",
  intro: "Hello!\n\nFresh this week.",
  signoff: "Thanks",
  products: [product(1, "Babka", "Bread", "https://img/b.jpg"), product(2, "Rugelach", "Pastry")],
  logoUrl: "https://dash/logo.png",
  shopName: "Just Cake",
  phone: "(514) 555-0100",
  address: "1 Main St\nMontreal",
  websiteUrl: "https://justcakeskosher.com",
  ...over,
});

/** Every product card is an inline-block with a max-width — the thing that
 *  lets two sit side by side on a tablet and stack on a phone. */
const cards = (html: string) => html.match(/display: inline-block; width: 100%; max-width: 288px/g) ?? [];

describe("the product email", () => {
  it("has a card per product that can wrap, not a fixed two-column table", () => {
    const html = buildEmailHtml(parts());
    expect(cards(html)).toHaveLength(2);
    expect(html).not.toMatch(/width="50%"/);
    expect(html).not.toMatch(/width="620"/);
  });

  it("uses inline styles only — Gmail strips <style> blocks", () => {
    expect(buildEmailHtml(parts())).not.toMatch(/<style/i);
  });

  it("escapes names, so a product called <b> can't inject markup", () => {
    const html = buildEmailHtml(parts({ products: [product(1, 'Cake <script>"x"', null)] }));
    expect(html).toContain("Cake &lt;script&gt;&quot;x&quot;");
    expect(html).not.toContain("<script>");
  });

  it("offers a call button and an order-online button", () => {
    const html = buildEmailHtml(parts());
    expect(html).toContain('href="tel:5145550100"');
    expect(html).toContain("Call to order");
    expect(html).toContain('href="https://justcakeskosher.com"');
    expect(html).toContain("Order online");
  });

  it("leaves the buttons out when there's nothing to link to", () => {
    const html = buildEmailHtml(parts({ phone: null, websiteUrl: null }));
    expect(html).not.toContain("Call to order");
    expect(html).not.toContain("Order online");
  });

  it("refuses a non-http website link", () => {
    const html = buildEmailHtml(parts({ websiteUrl: "javascript:alert(1)" }));
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Order online");
  });

  it("shows category headings only when there is more than one category", () => {
    expect(buildEmailHtml(parts())).toContain(">Bread</div>");
    const one = buildEmailHtml(parts({ products: [product(1, "Babka", "Bread"), product(2, "Challah", "Bread")] }));
    expect(one).not.toContain(">Bread</div>");
  });

  it("puts the address in the footer, keeping its line breaks", () => {
    expect(buildEmailHtml(parts())).toContain("1 Main St<br>Montreal");
  });
});

describe("the plain-text version", () => {
  it("groups by category and ends with how to order", () => {
    const text = buildEmailText(parts());
    expect(text).toContain("BREAD\n• Babka — $12.50");
    expect(text).toContain("PASTRY\n• Rugelach — $12.50");
    expect(text.trim().endsWith("Order online: https://justcakeskosher.com")).toBe(true);
  });
});

describe("dialling and grouping", () => {
  it("turns a typed phone number into something a tablet can dial", () => {
    expect(telHref("(514) 555-0100")).toBe("tel:5145550100");
    expect(telHref("+1 514-555-0100 ext 2")).toBe("tel:+15145550100");
    expect(telHref("call us")).toBe("");
  });

  it("keeps the order products were picked in, uncategorised last", () => {
    const groups = groupByCategory([
      product(1, "A", "Pastry"), product(2, "B", null), product(3, "C", "Bread"), product(4, "D", "Pastry"),
    ]);
    expect(groups.map((g) => [g.category, g.products.map((p) => p.name)])).toEqual([
      ["Pastry", ["A", "D"]], ["Bread", ["C"]], [null, ["B"]],
    ]);
  });
});
