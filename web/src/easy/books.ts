// The easy app's bookkeeping: vendors and their unpaid bills. Plain functions
// so the money logic is tested without a screen.

import type { Company, LedgerEntry } from "../api/types";

/** Bills (charges) not yet marked paid, oldest first — the order to pay them in. */
export function unpaidBills(entries: LedgerEntry[]): LedgerEntry[] {
  return entries
    .filter((e) => e.type === "charge" && !e.paid_on)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.id - b.id);
}

/** Suppliers only (we owe them), most owed first, then by name. */
export function vendorsByOwed(companies: Company[]): Company[] {
  return companies
    .filter((c) => c.type === "payable" && c.active)
    .sort((a, b) => Number(b.balance) - Number(a.balance) || a.name.localeCompare(b.name));
}

/** Customers on account (they owe us), most owed first, then by name. */
export function customersByOwed(companies: Company[]): Company[] {
  return companies
    .filter((c) => c.type === "receivable" && c.active)
    .sort((a, b) => Number(b.balance) - Number(a.balance) || a.name.localeCompare(b.name));
}

/** The account's lines, newest first — what a person checks against their paper. */
export function recentEntries(entries: LedgerEntry[], limit = 15): LedgerEntry[] {
  return [...entries]
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.id - a.id)
    .slice(0, limit);
}

/** A money amount typed on a tablet: "12", "12.5", "$12.50". Null when it isn't one. */
export function parseAmount(text: string): string | null {
  const t = text.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n.toFixed(2) : null;
}
