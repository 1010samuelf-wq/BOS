import { describe, expect, it } from "vitest";

import type { Product } from "../api/types";
import { MAX_PHOTOS_PER_PRODUCT, productOptions, uploadBatch } from "./photoInbox";

const file = (name: string) => new File(["x"], name, { type: "image/jpeg" });

function product(id: number, name: string, category: string | null, photos = 0): Product {
  return {
    id,
    name,
    category,
    photos: Array.from({ length: photos }, (_, i) => ({ id: id * 100 + i, url: `u${i}`, position: i })),
  } as unknown as Product;
}

describe("uploading a batch", () => {
  it("uploads every file and reports progress to the end", async () => {
    const seen: string[] = [];
    const progress: number[] = [];
    const r = await uploadBatch(
      [file("a.jpg"), file("b.jpg"), file("c.jpg"), file("d.jpg")],
      async (f) => { seen.push(f.name); },
      (done) => progress.push(done),
    );
    expect(r).toEqual({ uploaded: 4, failed: [] });
    expect(seen.sort()).toEqual(["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
    expect(progress[progress.length - 1]).toBe(4);
  });

  it("names the files that failed and still uploads the rest", async () => {
    const r = await uploadBatch(
      [file("good.jpg"), file("huge.jpg"), file("also-good.jpg")],
      async (f) => {
        if (f.name === "huge.jpg") throw new Error("Photo must be under 5 MB.");
      },
    );
    expect(r.uploaded).toBe(2);
    expect(r.failed).toEqual([{ name: "huge.jpg", message: "Photo must be under 5 MB." }]);
  });

  it("never has more than the pool size in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    await uploadBatch(
      Array.from({ length: 10 }, (_, i) => file(`${i}.jpg`)),
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
      },
      undefined,
      3,
    );
    expect(peak).toBe(3);
  });

  it("copes with an empty selection", async () => {
    expect(await uploadBatch([], async () => {})).toEqual({ uploaded: 0, failed: [] });
  });
});

describe("the product picker", () => {
  it("groups by category, alphabetically, uncategorised last", () => {
    const groups = productOptions([
      product(1, "Rugelach", "Pastry"),
      product(2, "Mystery", null),
      product(3, "Babka", "Bread"),
      product(4, "Croissant", "Pastry"),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["Bread", "Pastry", "Uncategorised"]);
    expect(groups[1].options.map((o) => o.id)).toEqual([4, 1]);
  });

  it("says which products have no photo yet", () => {
    const [g] = productOptions([product(1, "Babka", "Bread", 0), product(2, "Challah", "Bread", 2)]);
    expect(g.options.map((o) => o.label)).toEqual(["Babka (no photo yet)", "Challah (2 photos)"]);
  });

  it("disables a product whose gallery is full", () => {
    const [g] = productOptions([
      product(1, "Full", "Cakes", MAX_PHOTOS_PER_PRODUCT),
      product(2, "Room", "Cakes", MAX_PHOTOS_PER_PRODUCT - 1),
    ]);
    expect(g.options.map((o) => [o.label, o.disabled])).toEqual([
      ["Full (full)", true],
      ["Room (7 photos)", false],
    ]);
  });
});
