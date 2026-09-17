import { describe, expect, it } from "vitest";

import { withCents } from "./money";

/** The cents filler runs on every price field in the app, so the thing worth
 *  pinning down is what it refuses to touch — silently tidying a typo into a
 *  plausible number is worse than leaving it visibly wrong. */
describe("withCents", () => {
  it("adds the cents to a whole number", () => {
    expect(withCents("150")).toBe("150.00");
    expect(withCents("7")).toBe("7.00");
    expect(withCents("0")).toBe("0.00");
  });

  it("completes a trailing point", () => {
    expect(withCents("150.")).toBe("150.00");
  });

  it("pads a single decimal", () => {
    expect(withCents("150.5")).toBe("150.50");
    expect(withCents("0.5")).toBe("0.50");
  });

  it("leaves a correct amount alone", () => {
    expect(withCents("12.34")).toBe("12.34");
  });

  it("trims surrounding space", () => {
    expect(withCents("  42 ")).toBe("42.00");
  });

  it("leaves anything that isn't a plain amount exactly as typed", () => {
    // A mistake should stay visible rather than being rewritten into
    // something that looks deliberate.
    for (const bad of ["abc", "", "   ", "3.456", "1,50", "-5", "12.3.4", "$20"]) {
      expect(withCents(bad)).toBe(bad);
    }
  });
});
