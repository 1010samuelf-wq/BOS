// Reports (§2D/§11): Daily/Monthly metric cards, payment breakdown, expenses,
// CSV + PDF export — with **drill-down**: every metric card and breakdown row is
// clickable and expands the itemized orders behind it; expense rows are editable.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  exportSummaryCsv,
  getDailyReport,
  getMonthlyReport,
  listOrders,
  openSummaryPdf,
  updateExpense,
} from "../api/endpoints";
import type { ExpenseOut, Order, SalesReport } from "../api/types";
import { ErrorMsg, Loading, PageHead, Tabs } from "../components/ui";

interface Drill {
  label: string;
  params: { payment_method?: string; paid_status?: string; exclude_cancelled?: boolean };
}

function DrillPanel({ report, drill, onClose }: { report: SalesReport; drill: Drill; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["report-drill", report.from_date, report.to_date, drill.label],
    queryFn: () => listOrders({ from: report.from_date, to: report.to_date, limit: 200, ...drill.params }),
  });
  return (
    <div className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}>{drill.label}</h2>
        <button className="btn neutral sm" style={{ marginLeft: "auto" }} onClick={onClose}>Close</button>
      </div>
      {q.isLoading ? <Loading /> : (
        <table>
          <thead><tr><th>Order</th><th>Client</th><th>Status</th><th>Paid</th><th className="num">Total</th></tr></thead>
          <tbody>
            {(q.data?.items ?? []).map((o: Order) => (
              <tr key={o.id}>
                <td>#{o.id}</td>
                <td>{o.client_name}</td>
                <td style={{ textTransform: "capitalize" }}>{o.status.replace("_", " ")}</td>
                <td>{o.paid_status}{o.payment_method ? ` · ${o.payment_method}` : ""}</td>
                <td className="num">${o.total}</td>
              </tr>
            ))}
            {q.isSuccess && q.data.items.length === 0 && <tr><td colSpan={5} className="muted">No matching orders.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ExpenseRow({ e, onSaved }: { e: ExpenseOut; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(e.description);
  const [amt, setAmt] = useState(e.amount);
  const save = useMutation({
    mutationFn: () => updateExpense(e.id, { description: desc, amount: amt }),
    onSuccess: () => { setEditing(false); onSaved(); },
  });
  if (editing) {
    return (
      <tr>
        <td><input className="input" value={desc} onChange={(ev) => setDesc(ev.target.value)} /></td>
        <td className="num">
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <input className="input" style={{ maxWidth: 90 }} value={amt} onChange={(ev) => setAmt(ev.target.value)} />
            <button className="btn primary sm" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
            <button className="btn neutral sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr style={{ cursor: "pointer" }} onClick={() => setEditing(true)} title="Click to edit">
      <td>{e.description}</td>
      <td className="num">${e.amount}</td>
    </tr>
  );
}

function Metric({ label, value, tone, onClick }: { label: string; value: string; tone?: string; onClick?: () => void }) {
  return (
    <div className="metric" style={onClick ? { cursor: "pointer" } : undefined} onClick={onClick}>
      <div className="label">{label}{onClick ? " ›" : ""}</div>
      <div className="value" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  );
}

export default function Reports() {
  const [mode, setMode] = useState<"daily" | "monthly">("daily");
  const [drill, setDrill] = useState<Drill | null>(null);
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ["report", mode],
    queryFn: () => (mode === "daily" ? getDailyReport() : getMonthlyReport()),
  });
  const r = q.data;
  const today = new Date().toISOString().slice(0, 10);
  const open = (d: Drill) => setDrill((cur) => (cur?.label === d.label ? null : d));

  const breakdownSegments = (rep: SalesReport) => {
    const b = rep.payment_breakdown;
    return [
      { label: "Cash", v: +b.cash, c: "var(--success)", drill: { payment_method: "cash" } },
      { label: "Card", v: +b.card, c: "var(--primary)", drill: { payment_method: "card" } },
      { label: "E-transfer", v: +b.etransfer, c: "#3a6ea5", drill: { payment_method: "etransfer" } },
      { label: "Unpaid", v: +b.unpaid, c: "var(--warn)", drill: { paid_status: "unpaid" } },
    ].filter((s) => s.v > 0);
  };

  return (
    <div className="page">
      <PageHead title="Reports">
        <Tabs value={mode} onChange={(m) => { setMode(m); setDrill(null); }}
          options={[{ key: "daily", label: "Daily" }, { key: "monthly", label: "Monthly" }]} />
        <button className="btn neutral" onClick={() => void exportSummaryCsv(today, today)}>Export CSV</button>
        <button className="btn neutral" onClick={() => void openSummaryPdf(today, today)}>Export PDF</button>
      </PageHead>

      {q.isLoading ? <Loading /> : q.isError ? <ErrorMsg>Reports require the reports section.</ErrorMsg> : r ? (
        <>
          <div className="metrics">
            <Metric label="Revenue" value={`$${r.revenue}`}
              onClick={() => open({ label: "Revenue — contributing orders", params: { exclude_cancelled: true } })} />
            <Metric label="Orders" value={String(r.order_count)}
              onClick={() => open({ label: "Orders in this period", params: { exclude_cancelled: true } })} />
            <Metric label="Ingredient cost" value={`$${r.ingredient_cost}`} />
            <Metric label="Profit" value={`$${r.profit}`} tone={+r.profit < 0 ? "var(--danger)" : "var(--success)"} />
          </div>

          <div className="card">
            <h2>Payment breakdown <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>— click a row to see its orders</span></h2>
            <div className="bar">
              {breakdownSegments(r).map((s) => {
                const total = breakdownSegments(r).reduce((a, x) => a + x.v, 0) || 1;
                return <div key={s.label} style={{ flex: s.v / total, background: s.c }} />;
              })}
            </div>
            <div className="legend">
              {breakdownSegments(r).map((s) => (
                <span key={s.label} className="item" style={{ cursor: "pointer" }}
                  onClick={() => open({ label: `${s.label} — orders`, params: s.drill })}>
                  <span className="dot" style={{ background: s.c }} /> {s.label} ${s.v.toFixed(2)} ›
                </span>
              ))}
            </div>
          </div>

          {drill && <DrillPanel report={r} drill={drill} onClose={() => setDrill(null)} />}

          <div className="card">
            <h2>Expenses <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>— click a row to edit</span></h2>
            {r.expenses.length === 0 ? <p className="muted">No expenses logged.</p> : (
              <table>
                <tbody>
                  {r.expenses.map((e) => (
                    <ExpenseRow key={e.id} e={e} onSaved={() => client.invalidateQueries({ queryKey: ["report"] })} />
                  ))}
                  <tr><td><strong>Total</strong></td><td className="num"><strong>${r.expenses_total}</strong></td></tr>
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
