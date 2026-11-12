import { afterEach, describe, expect, it } from "vitest";

import type { ProductListChange, ProductListRow } from "../api/types";
import { clearDraft, editedCount, leftAfterSave, loadDraft, saveDraft, startingRows, summarize } from "./productListDraft";

const row = (baker: string, name = baker + " (nice)", price = "48"): ProductListRow => ({
  name, baker_name: baker, price, category: "Platters", note: "", include: true,
});

afterEach(() => clearDraft("t"));

describe("remembering edits", () => {
  it("keeps typed names between visits", () => {
    const rows = [row("Rum balls", "Our Rum Truffles")];
    saveDraft("t", rows);
    expect(loadDraft("t")).toEqual(rows);
  });

  it("lays the draft over the list by baker's name, whatever the order or length", () => {
    const base = [row("Rum balls"), row("Razzle")];
    const draft = [row("Rum balls", "Mine"), { ...row("Razzle", "Also mine"), include: false }];
    expect(startingRows(base, draft).map((r) => [r.name, r.include])).toEqual([
      ["Mine", true],
      ["Also mine", false],
    ]);
    // Rum balls was saved elsewhere and left the list: Razzle keeps its typing,
    // not Rum balls' (matching by position would have swapped them).
    expect(startingRows([row("Razzle")], draft).map((r) => r.name)).toEqual(["Also mine"]);
    // A row the draft never saw comes in with its suggestion.
    expect(startingRows([...base, row("New")], draft)[2].name).toBe("New (nice)");
  });

  it("starts from the list when there is no draft", () => {
    const base = [row("Rum balls")];
    expect(startingRows(base, null)).toBe(base);
  });

  it("compares edits with the same row's suggestion, not the one in the same place", () => {
    const base = [row("A"), row("B")];
    expect(editedCount(base, [base[1]])).toBe(0);
    expect(editedCount(base, [{ ...base[1], price: "50" }])).toBe(1);
  });

  it("counts what was changed", () => {
    const base = [row("A"), row("B"), row("C")];
    const rows = [{ ...base[0], name: "Better A" }, base[1], { ...base[2], include: false }];
    expect(editedCount(base, rows)).toBe(2);
  });
});

describe("the preview summary", () => {
  it("counts what Save would write", () => {
    const c = (action: ProductListChange["action"]): ProductListChange => ({
      action, name: "x", baker_name: "x", product_id: null, old_name: null, old_price: null, new_price: null, reason: "",
    });
    expect(summarize([c("add"), c("add"), c("update"), c("unchanged"), c("skip"), c("excluded")])).toEqual({
      add: 2, update: 1, unchanged: 1, skip: 1, excluded: 1, writes: 3,
    });
  });
});

describe("after saving", () => {
  it("keeps only the rows that aren't products now", () => {
    const rows = [row("Added"), row("Renamed"), row("Was there"), row("Unticked"), row("Bad price")];
    const c = (action: ProductListChange["action"]): ProductListChange => ({
      action, name: "x", baker_name: "x", product_id: null, old_name: null, old_price: null, new_price: null, reason: "",
    });
    const left = leftAfterSave(rows, [c("add"), c("update"), c("unchanged"), c("excluded"), c("skip")]);
    expect(left.map((r) => r.baker_name)).toEqual(["Unticked", "Bad price"]);
  });
});
