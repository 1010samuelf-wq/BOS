// The easy app's product editor: what the form holds, what's wrong with it,
// and what actually changed. Plain functions, tested without a screen.

import type { Product } from "../api/types";
import { parseAmount } from "./books";

export interface ProductForm {
  name: string;
  price: string;
  category: string;
  onWebsite: boolean;
  selling: boolean;
}

/** A new product starts off the website: it goes on once someone has given it a photo. */
export function blankForm(): ProductForm {
  return { name: "", price: "", category: "", onWebsite: false, selling: true };
}

export function formOf(p: Product): ProductForm {
  return { name: p.name, price: p.price, category: p.category ?? "", onWebsite: p.show_on_menu, selling: p.active };
}

/** What's wrong, in words for the person, or null when it can be saved. */
export function formProblem(f: ProductForm): string | null {
  if (!f.name.trim()) return "Type the product's name.";
  if (f.name.trim().length > 200) return "That name is too long.";
  if (parseAmount(f.price) === null && Number(f.price) !== 0) return "Type the price, like 14 or 3.50.";
  return null;
}

function cleanPrice(text: string): string {
  return parseAmount(text) ?? "0.00";
}

/** The new product, as the API takes it. */
export function toCreate(f: ProductForm) {
  return {
    name: f.name.trim().replace(/\s+/g, " "),
    price: cleanPrice(f.price),
    category: f.category.trim() || null,
    show_on_menu: f.onWebsite,
    active: f.selling,
  };
}

/** Only what changed, so a save never rewrites fields nobody touched. */
export function changes(p: Product, f: ProductForm): Partial<Product> {
  const out: Partial<Product> = {};
  const name = f.name.trim().replace(/\s+/g, " ");
  if (name !== p.name) out.name = name;
  const price = cleanPrice(f.price);
  if (Number(price) !== Number(p.price)) out.price = price;
  const category = f.category.trim() || null;
  if (category !== (p.category ?? null)) out.category = category;
  if (f.onWebsite !== p.show_on_menu) out.show_on_menu = f.onWebsite;
  if (f.selling !== p.active) out.active = f.selling;
  return out;
}
