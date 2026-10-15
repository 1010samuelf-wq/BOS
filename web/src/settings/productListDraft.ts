// The editable product list in Settings → Products, kept as plain functions so
// it can be tested without rendering.

import type { ProductListChange, ProductListRow } from "../api/types";

/** Edits are kept per list in this browser, so names can be worked on over a
 *  few sittings. Storage can be missing or full (private mode, a locked-down
 *  tablet) — then the screen just works without remembering. */
const key = (list: string) => `bos.productListDraft.${list}`;

export function loadDraft(list: string): ProductListRow[] | null {
  try {
    const raw = localStorage.getItem(key(list));
    const rows = raw ? (JSON.parse(raw) as ProductListRow[]) : null;
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

export function saveDraft(list: string, rows: ProductListRow[]): void {
  try {
    localStorage.setItem(key(list), JSON.stringify(rows));
  } catch {
    /* not remembered; nothing else depends on it */
  }
}

export function clearDraft(list: string): void {
  try {
    localStorage.removeItem(key(list));
  } catch {
    /* ignore */
  }
}

/** The rows to show: a saved draft if it still matches the list (same items in
 *  the same order), otherwise the list as shipped. A list that changed under a
 *  draft would put edited names on the wrong items, so the draft is dropped. */
export function startingRows(base: ProductListRow[], draft: ProductListRow[] | null): ProductListRow[] {
  if (
    draft &&
    draft.length === base.length &&
    draft.every((d, i) => d.baker_name === base[i].baker_name)
  ) {
    return draft;
  }
  return base;
}

/** How many rows the person has changed from the list as shipped. */
export function editedCount(base: ProductListRow[], rows: ProductListRow[]): number {
  return rows.filter(
    (r, i) => base[i] && (r.name !== base[i].name || r.price !== base[i].price || r.include !== base[i].include),
  ).length;
}

export interface ListSummary {
  add: number;
  update: number;
  unchanged: number;
  skip: number;
  excluded: number;
  /** What Save would actually write. */
  writes: number;
}

export function summarize(changes: ProductListChange[]): ListSummary {
  const s = { add: 0, update: 0, unchanged: 0, skip: 0, excluded: 0, writes: 0 };
  for (const c of changes) s[c.action] += 1;
  s.writes = s.add + s.update;
  return s;
}
