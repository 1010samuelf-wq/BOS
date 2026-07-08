// Production summary / bake list (§2D/§11): per-product needed / orders /
// in-stock / to-bake for a date-range preset, with totals + CSV export.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { exportProductionCsv, getProduction } from "../api/endpoints";
import { Loading, PageHead, Tabs } from "../components/ui";

type Preset = "today" | "tomorrow" | "week";

function range(preset: Preset): { from: string; to: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  if (preset === "today") return { from: iso(now), to: iso(now) };
  if (preset === "tomorrow") {
    const t = new Date(now);
    t.setDate(now.getDate() + 1);
    return { from: iso(t), to: iso(t) };
  }
  const end = new Date(now);
  end.setDate(now.getDate() + 6);
  return { from: iso(now), to: iso(end) };
}

export default function Production() {
  const [preset, setPreset] = useState<Preset>("today");
  const r = range(preset);
  const q = useQuery({ queryKey: ["production", preset], queryFn: () => getProduction(r) });

  return (
    <div className="page">
      <PageHead title="Production">
        <Tabs
          value={preset}
          onChange={setPreset}
          options={[
            { key: "today", label: "Today" },
            { key: "tomorrow", label: "Tomorrow" },
            { key: "week", label: "This week" },
          ]}
        />
        <button className="btn neutral" onClick={() => void exportProductionCsv(r.from, r.to)}>Export CSV</button>
      </PageHead>

      {q.isLoading ? (
        <Loading />
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Needed</th>
                <th className="num">Orders</th>
                <th className="num">In stock</th>
                <th className="num">To bake</th>
              </tr>
            </thead>
            <tbody>
              {(q.data?.rows ?? []).map((row) => (
                <tr key={row.product_id}>
                  <td>{row.product_name}</td>
                  <td className="num">{row.total_quantity}</td>
                  <td className="num">{row.order_count}</td>
                  <td className="num">{row.in_stock}</td>
                  <td className="num" style={{ color: "var(--primary)", fontWeight: 700 }}>{row.to_bake}</td>
                </tr>
              ))}
              {q.data && q.data.rows.length > 0 && (
                <tr>
                  <td><strong>TOTAL</strong></td>
                  <td className="num"><strong>{q.data.total_needed}</strong></td>
                  <td />
                  <td />
                  <td className="num"><strong>{q.data.total_to_bake}</strong></td>
                </tr>
              )}
            </tbody>
          </table>
          {q.data && q.data.rows.length === 0 && <p className="muted">Nothing to bake for this range.</p>}
        </div>
      )}
    </div>
  );
}
