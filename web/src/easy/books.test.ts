import { describe, expect, it } from "vitest";

import type { Company, LedgerEntry } from "../api/types";
import { customersByOwed, parseAmount, recentEntries, unpaidBills, vendorsByOwed } from "./books";

const entry = (id: number, date: string, type: "charge" | "payment", paid_on: string | null = null): LedgerEntry =>
  ({ id, entry_date: date, type, amount: "10.00", invoice_number: null, paid_on }) as LedgerEntry;

const company = (id: number, name: string, balance: string, type: "payable" | "receivable" = "payable", active = true): Company =>
  ({ id, name, balance, type, active }) as Company;

describe("bookkeeping", () => {
  it("lists only bills not yet paid, oldest first", () => {
    const bills = unpaidBills([
      entry(1, "2026-11-20", "charge"),
      entry(2, "2026-11-02", "charge"),
      entry(3, "2026-11-05", "charge", "2026-11-06"),
      entry(4, "2026-11-06", "payment"),
    ]);
    expect(bills.map((b) => b.id)).toEqual([2, 1]);
  });

  it("puts the vendor we owe most first and leaves out customers and archived ones", () => {
    const list = vendorsByOwed([
      company(1, "Costco", "120.00"),
      company(2, "Flour Mill", "900.50"),
      company(3, "Catering client", "500.00", "receivable"),
      company(4, "Old supplier", "50.00", "payable", false),
      company(5, "Butcher", "0.00"),
    ]);
    expect(list.map((c) => c.name)).toEqual(["Flour Mill", "Costco", "Butcher"]);
  });

  it("lists customers who owe us, most first", () => {
    const list = customersByOwed([
      company(1, "Costco", "120.00"),
      company(2, "Shul kiddush", "250.00", "receivable"),
      company(3, "Caterer", "900.00", "receivable"),
      company(4, "Old client", "10.00", "receivable", false),
    ]);
    expect(list.map((c) => c.name)).toEqual(["Caterer", "Shul kiddush"]);
  });

  it("shows the newest account lines first", () => {
    const lines = recentEntries([
      entry(1, "2026-11-01", "charge"),
      entry(2, "2026-11-20", "payment"),
      entry(3, "2026-11-20", "charge"),
    ], 2);
    expect(lines.map((e) => e.id)).toEqual([3, 2]);
  });

  it("reads amounts the way people type them", () => {
    expect(parseAmount("12")).toBe("12.00");
    expect(parseAmount(" $12.5 ")).toBe("12.50");
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("12.345")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});
