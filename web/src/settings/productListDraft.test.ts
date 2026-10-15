import { afterEach, describe, expect, it } from "vitest";

import type { ProductListChange, ProductListRow } from "../api/types";
import { clearDraft, editedCount, loadDraft, saveDraft, startingRows, summarize } from "./productListDraft";

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

  it("uses the draft only while it still matches the list", () => {
    const base = [row("Rum balls"), row("Razzle")];
    const draft = [row("Rum balls", "Mine"), row("Razzle", "Also mine")];
    expect(startingRows(base, draft)).toBe(draft);
    // The list changed (an item added) — edited names could land on the wrong item.
    expect(startingRows([...base, row("New")], draft)).toEqual([...base, row("New")]);
    expect(startingRows([row("Razzle"), row("Rum balls")], draft)[0].name).toBe("Razzle (nice)");
  });

  it("starts from the list when there is no draft", () => {
    const base = [row("Rum balls")];
    expect(startingRows(base, null)).toBe(base);
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
