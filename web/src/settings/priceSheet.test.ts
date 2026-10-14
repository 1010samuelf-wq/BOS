import { describe, expect, it } from "vitest";

import type { PriceChange } from "../api/types";
import { ordered, sheetLabel, summarize } from "./priceSheet";

const c = (action: PriceChange["action"], name: string): PriceChange => ({
  action, name, ingredient_id: null, unit: "lb", old_price: null, new_price: "1", note: "", reason: "",
});

describe("the price sheet preview", () => {
  it("counts what Apply would write, not what it would leave", () => {
    const s = summarize([c("add", "a"), c("add", "b"), c("update", "c"), c("unchanged", "d"), c("skip", "e")]);
    expect(s).toEqual({ add: 2, update: 1, unchanged: 1, skip: 1, writes: 3 });
  });

  it("puts changed prices first, then the ones needing a person", () => {
    const names = ordered([c("add", "Almonds"), c("unchanged", "Salt"), c("skip", "Eggs"), c("update", "Butter")])
      .map((x) => x.name);
    expect(names).toEqual(["Butter", "Eggs", "Almonds", "Salt"]);
  });

  it("names a sheet by its date", () => {
    expect(sheetLabel("ingredient_prices_2026-10")).toBe("Price sheet 2026-10");
  });
});
