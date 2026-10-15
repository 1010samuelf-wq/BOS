// Settings → Products → Add products from a list.
//
// The baker's item list, one row per item, with the new name and price
// editable before anything is saved. Typing is remembered in this browser, so
// names can be worked on over several sittings. Preview shows what Save would
// do; Save is only offered for exactly what was previewed.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiRequestError } from "../api/client";
import * as api from "../api/endpoints";
import type { ProductListImport as ImportResult, ProductListRow } from "../api/types";
import { clearDraft, editedCount, loadDraft, saveDraft, startingRows, summarize } from "./productListDraft";

const STATUS: Record<string, string> = {
  add: "New",
  update: "Rename / re-price",
  unchanged: "Already saved",
  skip: "Can't save",
  excluded: "Left out",
};

export default function ProductListImport() {
  const client = useQueryClient();
  const lists = useQuery({ queryKey: ["product-lists"], queryFn: api.listProductLists });
  const listName = lists.data?.[0]?.name ?? "";
  const base = useQuery({
    queryKey: ["product-list", listName],
    queryFn: () => api.getProductList(listName),
    enabled: !!listName,
  });

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ProductListRow[] | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [stale, setStale] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  useEffect(() => {
    if (base.data && rows === null) setRows(startingRows(base.data, loadDraft(listName)));
  }, [base.data, listName, rows]);

  const run = useMutation({
    mutationFn: (apply: boolean) => api.importProductList(rows ?? [], apply),
    onMutate: () => setError(null),
    onSuccess: (r) => {
      setResult(r);
      setStale(false);
      if (r.applied) {
        setSaved(summarize(r.changes).writes);
        clearDraft(listName);
        client.invalidateQueries({ queryKey: ["products"] });
        client.invalidateQueries({ queryKey: ["product-categories"] });
      }
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Couldn't reach the server."),
  });

  // Optional card: nothing shipped, or the list didn't load — stay out of the way.
  if (!listName || !base.data || !rows) return null;

  const edit = (i: number, patch: Partial<ProductListRow>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    setRows(next);
    saveDraft(listName, next);
    setStale(true);
    setSaved(null);
  };
  const summary = result ? summarize(result.changes) : null;
  const edited = editedCount(base.data, rows);

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Add products from the baker's list</h2>
        <button className="btn neutral" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : `Open list (${rows.length} items)`}
        </button>
      </div>
      {!open ? (
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          Give each item a nicer name and check the price, then save them as products.
          {edited > 0 && <> You've edited {edited} so far — it's remembered on this device.</>}
        </p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            Type a nicer name over the suggestion, fix any price, untick anything you don't sell.
            Your typing is kept on this device until you save. New products go straight into
            the order screen but stay <b>off the website</b> until you switch them on.
          </p>

          <div style={{ overflowX: "auto" }}>
            <table className="list-import">
              <thead>
                <tr><th></th><th>Baker's name</th><th>New name</th><th className="num">Price</th><th>Category</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const c = !stale ? result?.changes[i] : undefined;
                  return (
                    <tr key={i} style={{ opacity: r.include ? 1 : 0.45 }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={r.include}
                          onChange={(e) => edit(i, { include: e.target.checked })}
                          aria-label={`Include ${r.baker_name}`}
                        />
                      </td>
                      <td className="muted">{r.baker_name}</td>
                      <td>
                        <input
                          className="input"
                          value={r.name}
                          onChange={(e) => edit(i, { name: e.target.value })}
                          disabled={!r.include}
                          aria-label={`New name for ${r.baker_name}`}
                          style={{ minWidth: 220, width: "100%" }}
                        />
                      </td>
                      <td className="num">
                        <input
                          className="input"
                          value={r.price}
                          inputMode="decimal"
                          onChange={(e) => edit(i, { price: e.target.value })}
                          disabled={!r.include}
                          aria-label={`Price for ${r.baker_name}`}
                          style={{ width: 80, textAlign: "right" }}
                        />
                      </td>
                      <td className="muted">{r.category}</td>
                      <td style={{ fontSize: 12 }}>
                        {c ? (
                          <>
                            <span className={c.action === "skip" ? "error" : undefined}>{STATUS[c.action]}</span>
                            {c.action === "update" && c.old_name && (
                              <div className="muted">was "{c.old_name}" ${c.old_price}</div>
                            )}
                            {c.reason && <div className="muted">{c.reason}</div>}
                          </>
                        ) : (
                          r.note && <span className="muted">{r.note}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {error && <p className="error">{error}</p>}
          {saved !== null && (
            <p><strong>Saved {saved} product{saved === 1 ? "" : "s"}.</strong> They're in the catalog below.</p>
          )}
          {summary && !stale && saved === null && (
            <p style={{ margin: "10px 0 6px" }}>
              {summary.add} new · {summary.update} rename/re-price · {summary.unchanged} already saved
              {summary.skip > 0 && <> · <span className="error">{summary.skip} can't be saved (see Status)</span></>}
              {summary.excluded > 0 && <> · {summary.excluded} left out</>}
            </p>
          )}

          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button className="btn neutral" disabled={run.isPending} onClick={() => run.mutate(false)}>
              {stale ? "Preview" : "Preview again"}
            </button>
            {summary && !stale && summary.writes > 0 && saved === null && (
              <button className="btn primary" disabled={run.isPending} onClick={() => run.mutate(true)}>
                Save {summary.writes} product{summary.writes === 1 ? "" : "s"}
              </button>
            )}
            {edited > 0 && (
              <button
                className="btn neutral"
                disabled={run.isPending}
                onClick={() => {
                  if (window.confirm("Undo all your edits and go back to the suggested names?")) {
                    clearDraft(listName);
                    setRows(base.data);
                    setStale(true);
                  }
                }}
              >
                Reset to suggestions
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
