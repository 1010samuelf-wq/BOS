// Stock (§2B/§11): Ingredients/Products tabs, search, low/negative toggle,
// color-coded quantities, inline +/- and a purchase entry. Manager+ can adjust
// (backend enforces).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiRequestError } from "../api/client";
import { adjustStock, getStock } from "../api/endpoints";
import type { ItemType, StockLevel } from "../api/types";
import { Loading, PageHead, Tabs, stockTone } from "../components/ui";

export default function Stock() {
  const [tab, setTab] = useState<ItemType>("ingredient");
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useQueryClient();

  const stock = useQuery({
    queryKey: ["stock", tab, lowOnly, q],
    queryFn: () => getStock({ item_type: tab, low_only: lowOnly, q: q || undefined }),
  });

  const adjust = useMutation({
    mutationFn: (v: { s: StockLevel; delta: string; reason: string }) =>
      adjustStock({ item_type: v.s.item_type, item_id: v.s.item_id, delta: v.delta, reason: v.reason }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["stock"] }),
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Adjustment failed."),
  });

  const promptPurchase = (s: StockLevel) => {
    const qty = window.prompt(`Quantity received for ${s.name}?`);
    if (qty && /^\d+(\.\d+)?$/.test(qty.trim())) adjust.mutate({ s, delta: qty.trim(), reason: "purchase" });
  };

  const rows = stock.data ?? [];
  const lowCount = rows.filter((r) => r.is_low || parseFloat(r.quantity) < 0).length;

  return (
    <div className="page">
      <PageHead title="Stock">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { key: "ingredient", label: "Ingredients" },
            { key: "product", label: "Products" },
          ]}
        />
      </PageHead>

      <div className="row" style={{ marginBottom: 16 }}>
        <input className="input" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <button className={`btn ${lowOnly ? "primary" : "neutral"}`} onClick={() => setLowOnly((v) => !v)}>
          Low / negative only
        </button>
      </div>

      {lowCount > 0 && <p className="tone-low"><strong>⚠ {lowCount} item(s) low or negative</strong></p>}
      {error && <p className="error">{error}</p>}

      {stock.isLoading ? (
        <Loading />
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th className="num">On hand</th>
                <th className="num">Adjust</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const tone = stockTone(s.quantity, s.is_low);
                return (
                  <tr key={`${s.item_type}-${s.item_id}`}>
                    <td><span className="dot" style={{ background: `var(${tone === "tone-neg" ? "--danger" : tone === "tone-low" ? "--warn" : "--success"})` }} /></td>
                    <td>{s.name ?? `#${s.item_id}`}</td>
                    <td className={`num ${tone}`} style={{ fontWeight: 700 }}>{s.quantity}</td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn neutral sm" onClick={() => adjust.mutate({ s, delta: "-1", reason: "manual -1" })}>−</button>
                        <button className="btn neutral sm" onClick={() => adjust.mutate({ s, delta: "1", reason: "manual +1" })}>+</button>
                        <button className="btn neutral sm" onClick={() => promptPurchase(s)}>Purchase</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="muted">Nothing here.</p>}
        </div>
      )}
    </div>
  );
}
