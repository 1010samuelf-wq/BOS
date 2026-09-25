import { describe, expect, it } from "vitest";

import { DEFAULT_TAB, resolveTab, visibleTabs } from "./tabs";

/** The tab comes from the URL, so it can be anything: an old bookmark, a typo,
 *  or a hand-edited address bar. */
describe("choosing the settings tab", () => {
  it("uses the tab that was asked for", () => {
    expect(resolveTab("recipes", true)).toBe("recipes");
  });

  it("opens on Products when nothing was asked for", () => {
    expect(resolveTab(null, true)).toBe(DEFAULT_TAB);
  });

  it("falls back rather than rendering an empty page", () => {
    expect(resolveTab("sideways", true)).toBe(DEFAULT_TAB);
    expect(resolveTab("", true)).toBe(DEFAULT_TAB);
  });

  it("is case-sensitive, so a near miss still lands somewhere usable", () => {
    expect(resolveTab("Recipes", true)).toBe(DEFAULT_TAB);
  });

  it("gives staff management to someone who can manage staff", () => {
    expect(resolveTab("employees", true)).toBe("employees");
  });

  /** The reason this file exists. Someone with `settings` but not `employees`
   *  must not reach the staff tab by editing the address bar — the backend
   *  would refuse the data, but a tab full of permission errors is a worse
   *  answer than not offering it. */
  it("refuses staff management to someone without the permission", () => {
    expect(resolveTab("employees", false)).toBe(DEFAULT_TAB);
  });
});

describe("which tabs are offered", () => {
  it("offers staff management only to those who can manage staff", () => {
    expect(visibleTabs(true).map((t) => t.key)).toContain("employees");
    expect(visibleTabs(false).map((t) => t.key)).not.toContain("employees");
  });

  it("keeps every other tab either way", () => {
    const withoutStaff = visibleTabs(false).map((t) => t.key);
    const withStaff = visibleTabs(true).map((t) => t.key).filter((k) => k !== "employees");
    expect(withoutStaff).toEqual(withStaff);
  });

  it("starts with the default tab, so the first one is always openable", () => {
    expect(visibleTabs(false)[0].key).toBe(DEFAULT_TAB);
    expect(visibleTabs(true)[0].key).toBe(DEFAULT_TAB);
  });

  it("every offered tab resolves to itself", () => {
    for (const staff of [true, false]) {
      for (const tab of visibleTabs(staff)) {
        expect(resolveTab(tab.key, staff)).toBe(tab.key);
      }
    }
  });

  it("labels every tab", () => {
    for (const tab of visibleTabs(true)) expect(tab.label.trim()).not.toBe("");
  });
});
