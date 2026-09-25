import { describe, expect, it } from "vitest";

import { stablePrefix } from "./partial";

/** Every case here is a real frame from a streamed answer — the states the
 *  text passes through on its way to being valid markdown. */
describe("holding back half-written markdown", () => {
  it("leaves a finished answer alone", () => {
    const text = "You have **two** orders for today.";
    expect(stablePrefix(text)).toBe(text);
  });

  it("leaves plain prose alone as it grows", () => {
    expect(stablePrefix("You have two")).toBe("You have two");
  });

  it("hides a table header until its rule arrives", () => {
    const text = "Two orders.\n\n| Order | Customer | Due |";
    expect(stablePrefix(text)).toBe("Two orders.\n");
  });

  it("hides a rule that is itself still arriving", () => {
    const text = "Two orders.\n\n| Order | Due |\n|---|";
    expect(stablePrefix(text)).toBe("Two orders.\n");
  });

  it("shows the table once the rule is complete", () => {
    const text = "Two orders.\n\n| Order | Due |\n|---|---|\n";
    expect(stablePrefix(text)).toBe(text);
  });

  it("keeps rows arriving after the rule", () => {
    const text = "| Order | Due |\n|---|---|\n| #101 | 2pm |\n| #102 | Ca";
    expect(stablePrefix(text)).toBe(text);
  });

  it("cuts an unclosed bold marker", () => {
    expect(stablePrefix("You have **two")).toBe("You have ");
  });

  it("keeps a closed bold marker", () => {
    expect(stablePrefix("You have **two** orders")).toBe("You have **two** orders");
  });

  it("keeps the first pair when a second opens", () => {
    expect(stablePrefix("**two** orders and **thr")).toBe("**two** orders and ");
  });

  it("handles a table under an unclosed bold line", () => {
    const text = "Today: **busy\n\n| Order |";
    expect(stablePrefix(text)).toBe("Today: ");
  });

  it("never grows the text it was given", () => {
    const frames = [
      "",
      "You ",
      "You have **two",
      "You have **two** orders for today.",
      "You have **two** orders for today.\n\n| Order",
      "You have **two** orders for today.\n\n| Order | Due |",
      "You have **two** orders for today.\n\n| Order | Due |\n|---|---|",
      "You have **two** orders for today.\n\n| Order | Due |\n|---|---|\n| #101 | 2pm |",
    ];
    for (const frame of frames) {
      expect(stablePrefix(frame).length).toBeLessThanOrEqual(frame.length);
    }
  });

  it("settles on the whole answer once it has all arrived", () => {
    const full = "You have **two** orders.\n\n| Order | Due |\n|---|---|\n| #101 | 2pm |\n";
    expect(stablePrefix(full)).toBe(full);
  });
});
