// Settings → Ingredients → Import a price sheet.
//
// Preview first, always: the table shows every price that would change and
// every row that was skipped, and nothing is written until Apply. Existing
// ingredients keep their unit (the server converts the price into it), so
// recipes priced off them stay right.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiRequestError } from "../api/client";
import * as api from "../api/endpoints";
import type { PriceImport } from "../api/types";
import { ordered, sheetLabel, summarize } from "./priceSheet";

const ACTION_LABEL = { update: "Price change", add: "New", unchanged: "Same", skip: "Skipped" } as const;

export default function PriceSheetImport() {
  const client = useQueryClient();
  const sheets = useQuery({ queryKey: ["price-sheets"], queryFn: api.listPriceSheets });
  const [chosen, setChosen] = useState("");
  const [result, setResult] = useState<PriceImport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sheet = chosen || sheets.data?.[0]?.name || "";
  const run = useMutation({
    mutationFn: (apply: boolean) => api.importPriceSheet(sheet, apply),
    onMutate: () => setError(null),
    onSuccess: (r) => {
      setResult(r);
      if (r.applied) client.invalidateQueries({ queryKey: ["ingredients"] });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Couldn't load the price sheet."),
  });

  // Nothing shipped yet, or the list failed: this card is optional, so stay
  // out of the way rather than putting an error above the ingredient list.
  if (!sheets.data?.length) return null;

  const summary = result ? summarize(result.changes) : null;

  return (
    <div className="card">
      <h2>Import a price sheet</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
        Preview shows every price that would change. Nothing is saved until you press Apply.
      </p>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <select
          className="input"
          value={sheet}
          onChange={(e) => { setChosen(e.target.value); setResult(null); }}
          style={{ maxWidth: 260 }}
          aria-label="Price sheet"
        >
          {sheets.data.map((s) => (
            <option key={s.name} value={s.name}>{sheetLabel(s.name)} ({s.rows} items)</option>
          ))}
        </select>
        <button className="btn neutral" disabled={run.isPending} onClick={() => run.mutate(false)}>
          Preview
        </button>
        {result && !result.applied && summary && summary.writes > 0 && (
          <button
            className="btn primary"
            disabled={run.isPending}
            onClick={() => run.mutate(true)}
          >
            Apply {summary.writes} change{summary.writes === 1 ? "" : "s"}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      {result && summary && (
        <>
          <p style={{ margin: "12px 0 6px" }}>
            {result.applied ? <strong>Saved. </strong> : null}
            {summary.update} price change{summary.update === 1 ? "" : "s"} · {summary.add} new ·{" "}
            {summary.unchanged} already right · {summary.skip} skipped
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr><th></th><th>Ingredient</th><th className="num">Now</th><th className="num">New</th><th>Note</th></tr>
              </thead>
              <tbody>
                {ordered(result.changes).map((c, i) => (
                  <tr key={i} style={{ opacity: c.action === "unchanged" ? 0.55 : 1 }}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{ACTION_LABEL[c.action]}</td>
                    <td>{c.name}</td>
                    <td className="num">{c.old_price ? `$${c.old_price}/${c.unit}` : "—"}</td>
                    <td className="num">{c.new_price ? `$${c.new_price}/${c.unit}` : "—"}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{c.reason || c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
