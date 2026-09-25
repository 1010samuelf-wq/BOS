// Which tab the Settings page is on.
//
// Kept out of the component so it can be tested without rendering: the tab
// comes from the URL, which means it can be anything — an old bookmark, a
// typo, or someone trying `?tab=employees` without the permission for it.

export type SettingsTab =
  | "products"
  | "ingredients"
  | "recipes"
  | "employees"
  | "business"
  | "tablet";

const LABELS: { key: SettingsTab; label: string }[] = [
  { key: "products", label: "Products" },
  { key: "ingredients", label: "Ingredients" },
  { key: "recipes", label: "Recipes" },
  { key: "employees", label: "Employees & hours" },
  { key: "business", label: "Business" },
  { key: "tablet", label: "Tablet app" },
];

export const DEFAULT_TAB: SettingsTab = "products";

/** The tabs this person may see, in order. */
export function visibleTabs(canManageStaff: boolean): { key: SettingsTab; label: string }[] {
  return LABELS.filter((t) => t.key !== "employees" || canManageStaff);
}

/** Turn whatever is in the URL into a tab that can actually be shown.
 *
 * Falls back to Products rather than rendering nothing, and refuses
 * `?tab=employees` for someone without the permission — the backend would
 * refuse the data anyway, but an empty tab with a permission error in it is a
 * worse answer than not offering the tab.
 */
export function resolveTab(asked: string | null, canManageStaff: boolean): SettingsTab {
  const allowed = visibleTabs(canManageStaff);
  const match = allowed.find((t) => t.key === asked);
  return match ? match.key : DEFAULT_TAB;
}
