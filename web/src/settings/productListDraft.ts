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

/** The rows to show: the server's list (only what isn't in the catalog yet),
 *  with this browser's edits laid over it row by row, matched on the baker's
 *  name. The list shrinks as rows are saved — here or on another device — so
 *  matching by position would put edited names on the wrong items. */
export function startingRows(base: ProductListRow[], draft: ProductListRow[] | null): ProductListRow[] {
  if (!draft) return base;
  const edits = new Map(draft.map((d) => [d.baker_name, d]));
  return base.map((b) => {
    const d = edits.get(b.baker_name);
    return d ? { ...b, name: d.name, price: d.price, include: d.include } : b;
  });
}

/** Edits are compared against what the list suggests for each row. */
function suggestionFor(base: ProductListRow[], row: ProductListRow): ProductListRow | undefined {
  return base.find((b) => b.baker_name === row.baker_name);
}

/** How many rows the person has changed from the list as shipped. */
export function editedCount(base: ProductListRow[], rows: ProductListRow[]): number {
  return rows.filter((r) => {
    const b = suggestionFor(base, r);
    return b && (r.name !== b.name || r.price !== b.price || r.include !== b.include);
  }).length;
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

/** The rows still to do after a save: everything except what is now a product
 *  (added, renamed, or already there). Unticked rows and ones that couldn't be
 *  saved stay, with their typing. */
export function leftAfterSave(rows: ProductListRow[], changes: ProductListChange[]): ProductListRow[] {
  return rows.filter((_, i) => {
    const action = changes[i]?.action;
    return action !== "add" && action !== "update" && action !== "unchanged";
  });
}
