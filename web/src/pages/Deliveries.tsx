// Delivery manifest (§2A/§11): today's delivery orders with box count (distinct
// lines), address, items, total, paid status, plus CSV export/print.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { deliveriesPdf, exportDeliveriesCsv, getDeliveries } from "../api/endpoints";
import { LoadFailed, Loading, PageHead, Tabs, isStalled } from "../components/ui";
import { formatNeeded } from "../order/dates";

type Preset = "today" | "tomorrow" | "week" | "upcoming" | "custom";

function range(preset: Exclude<Preset, "custom">): { from: string; to: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  if (preset === "today") return { from: iso(now), to: iso(now) };
  if (preset === "tomorrow") {
    const t = new Date(now);
    t.setDate(now.getDate() + 1);
    return { from: iso(t), to: iso(t) };
  }
  if (preset === "week") {
    const end = new Date(now);
    end.setDate(now.getDate() + 6);
    return { from: iso(now), to: iso(end) };
  }
  const end = new Date(now);
  end.setFullYear(now.getFullYear() + 5);
  return { from: iso(now), to: iso(end) };
}

export default function Deliveries() {
  const [preset, setPreset] = useState<Preset>("today");
  const today = new Date().toISOString().slice(0, 10);
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const r = preset === "custom" ? { from: customFrom, to: customTo } : range(preset);
  const q = useQuery({
    queryKey: ["deliveries", preset, r.from, r.to],
    queryFn: () => getDeliveries(r),
    enabled: preset !== "custom" || (!!customFrom && !!customTo && customFrom <= customTo),
  });

  return (
    <div className="page">
      <PageHead title="Deliveries">
        <Tabs
          value={preset}
          onChange={setPreset}
          options={[
            { key: "today", label: "Today" },
            { key: "tomorrow", label: "Tomorrow" },
            { key: "week", label: "This week" },
            { key: "upcoming", label: "Upcoming (no limit)" },
            { key: "custom", label: "Custom range" },
          ]}
        />
        {preset === "custom" && (
          <>
            <input className="input" type="date" style={{ maxWidth: 150 }} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <input className="input" type="date" style={{ maxWidth: 150 }} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}
        <button className="btn neutral" onClick={() => void deliveriesPdf(r.from, r.to)}>🖨 Driver PDF</button>
        <button className="btn neutral" onClick={() => void exportDeliveriesCsv(r.from, r.to)}>Export CSV</button>
      </PageHead>

      {q.isLoading ? (
        <Loading />
      ) : isStalled(q) ? (
        <LoadFailed what="deliveries" onRetry={() => void q.refetch()} />
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Needed</th>
                <th>Client</th>
                <th>Recipient</th>
                <th>Address</th>
                <th>Items</th>
                <th className="num">Boxes</th>
                <th className="num">Total</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {(q.data?.rows ?? []).map((r) => (
                <tr key={r.order_id}>
                  <td>{r.needed_for_date ? formatNeeded(r.needed_for_date) : "—"}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.client_name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{r.client_phone}</div>
                  </td>
                  <td>{r.delivery_name ?? "—"}</td>
                  <td>{r.delivery_address ?? "—"}</td>
                  <td className="muted">{r.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}</td>
                  <td className="num">{r.box_count}</td>
                  <td className="num">${r.total}</td>
                  <td><span className={`pill ${r.paid_status}`}>{r.paid_status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.data && q.data.rows.length === 0 && <p className="muted">No deliveries today.</p>}
        </div>
      )}
    </div>
  );
}
