// Orders (§2A/§11): a "By date" view — all outstanding orders sorted by
// needed-for date, with Today/Tomorrow/This week/Custom preset filters — and a
// filterable List — product-name search, date range (order or needed-for), and
// status / paid / fulfillment dropdowns with Clear. Overdue rows red; click →
// detail. Orders with no needed-for date always show (nothing to bucket them
// into) rather than silently disappearing under a preset.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { listOrders } from "../api/endpoints";
import type { Order, OrderStatus } from "../api/types";
import { Loading, PageHead, Tabs } from "../components/ui";
import { asDate, formatNeeded, neededDeadline } from "../order/dates";

function isOverdue(o: Order): boolean {
  return (
    o.fulfillment_status !== "fulfilled" &&
    o.status !== "cancelled" &&
    !!o.needed_for_date &&
    neededDeadline(o.needed_for_date) < Date.now()
  );
}

function statusLabel(s: OrderStatus): string {
  return s === "in_progress" ? "In progress" : s;
}
function statusPillClass(s: OrderStatus): string {
  if (s === "ready") return "pill status-ready";
  if (s === "in_progress") return "pill status-progress";
  return "pill status-pending";
}

type DatePreset = "today" | "tomorrow" | "week" | "custom";

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function presetRange(preset: Exclude<DatePreset, "custom">): { from: string; to: string } {
  const now = new Date();
  if (preset === "today") return { from: localDay(now), to: localDay(now) };
  if (preset === "tomorrow") {
    const t = addDays(now, 1);
    return { from: localDay(t), to: localDay(t) };
  }
  return { from: localDay(now), to: localDay(addDays(now, 6)) };
}

function DateOrdersView() {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<DatePreset>("today");
  const today = localDay(new Date());
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const range = preset === "custom" ? { from: customFrom, to: customTo } : presetRange(preset);

  const q = useQuery({
    queryKey: ["orders", "outstanding"],
    queryFn: () => listOrders({ limit: 200, fulfillment_status: "pending", exclude_cancelled: true }),
  });

  const rows = (q.data?.items ?? [])
    .filter((o) => {
      if (!o.needed_for_date) return true; // no date to bucket — always show
      const day = localDay(asDate(o.needed_for_date));
      return day >= range.from && day <= range.to;
    })
    .sort((a, b) => {
      if (!a.needed_for_date && !b.needed_for_date) return 0;
      if (!a.needed_for_date) return -1;
      if (!b.needed_for_date) return 1;
      return asDate(a.needed_for_date).getTime() - asDate(b.needed_for_date).getTime();
    });

  return (
    <div>
      <div className="card">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Tabs
            value={preset}
            onChange={setPreset}
            options={[
              { key: "today", label: "Today" },
              { key: "tomorrow", label: "Tomorrow" },
              { key: "week", label: "This week" },
              { key: "custom", label: "Custom range" },
            ]}
          />
          {preset === "custom" && (
            <>
              <input className="input" type="date" style={{ maxWidth: 150 }} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <input className="input" type="date" style={{ maxWidth: 150 }} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </>
          )}
        </div>
      </div>

      {q.isLoading ? (
        <Loading />
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Order</th><th>Client</th><th>Needed for</th><th>Items</th><th>Type</th><th>Status</th><th>Paid</th><th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className={isOverdue(o) ? "overdue" : ""} style={{ cursor: "pointer" }} onClick={() => navigate(`/orders/${o.id}`)}>
                  <td>#{o.id}</td>
                  <td>{o.client_name}</td>
                  <td>{o.needed_for_date ? formatNeeded(o.needed_for_date) : "No date set"}</td>
                  <td className="muted">{o.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}</td>
                  <td style={{ textTransform: "capitalize" }}>{o.fulfillment_type}</td>
                  <td><span className={statusPillClass(o.status)}>{statusLabel(o.status)}</span></td>
                  <td><span className={`pill ${o.paid_status}`}>{o.paid_status}</span></td>
                  <td className="num">${o.total}</td>
                </tr>
              ))}
              {q.isSuccess && rows.length === 0 && <tr><td colSpan={8} className="muted">No orders in this range.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const EMPTY = {
  product_name: "", date_field: "order", from: "", to: "",
  status: "", paid_status: "", fulfillment_type: "", fulfillment_status: "",
};

function OrdersList() {
  const navigate = useNavigate();
  const [f, setF] = useState(EMPTY);
  const set = (patch: Partial<typeof EMPTY>) => setF((cur) => ({ ...cur, ...patch }));
  const active = Object.entries(f).some(([k, v]) => v && !(k === "date_field" && v === "order"));

  const q = useQuery({
    queryKey: ["orders", "list", f],
    queryFn: () => listOrders({
      limit: 200,
      product_name: f.product_name || undefined,
      date_field: f.date_field,
      from: f.from || undefined,
      to: f.to || undefined,
      status: f.status || undefined,
      paid_status: f.paid_status || undefined,
      fulfillment_type: f.fulfillment_type || undefined,
      fulfillment_status: f.fulfillment_status || undefined,
    }),
  });

  return (
    <div>
      <div className="card">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input className="input" style={{ maxWidth: 200 }} placeholder="Product name…"
            value={f.product_name} onChange={(e) => set({ product_name: e.target.value })} />
          <select className="input" style={{ maxWidth: 150 }} value={f.date_field} onChange={(e) => set({ date_field: e.target.value })}>
            <option value="order">Order date</option>
            <option value="needed">Needed-for date</option>
          </select>
          <input className="input" style={{ maxWidth: 150 }} type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
          <input className="input" style={{ maxWidth: 150 }} type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
          <select className="input" style={{ maxWidth: 140 }} value={f.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any status</option>
            <option value="pending">Pending</option>
            <option value="ready">Ready</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select className="input" style={{ maxWidth: 120 }} value={f.paid_status} onChange={(e) => set({ paid_status: e.target.value })}>
            <option value="">Any paid</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
          </select>
          <select className="input" style={{ maxWidth: 130 }} value={f.fulfillment_type} onChange={(e) => set({ fulfillment_type: e.target.value })}>
            <option value="">Any type</option>
            <option value="pickup">Pickup</option>
            <option value="delivery">Delivery</option>
          </select>
          <select className="input" style={{ maxWidth: 130 }} value={f.fulfillment_status} onChange={(e) => set({ fulfillment_status: e.target.value })}>
            <option value="">Active + done</option>
            <option value="pending">In progress</option>
            <option value="fulfilled">Fulfilled</option>
          </select>
          <button className="btn neutral" disabled={!active} onClick={() => setF(EMPTY)}>Clear</button>
        </div>
      </div>

      {q.isLoading ? <Loading /> : (
        <div className="card">
          <table>
            <thead><tr><th>Order</th><th>Client</th><th>Needed for</th><th>Type</th><th>Status</th><th>Paid</th><th className="num">Total</th></tr></thead>
            <tbody>
              {(q.data?.items ?? []).map((o) => (
                <tr key={o.id} className={isOverdue(o) ? "overdue" : ""} style={{ cursor: "pointer" }} onClick={() => navigate(`/orders/${o.id}`)}>
                  <td>#{o.id}</td>
                  <td>{o.client_name}</td>
                  <td>{o.needed_for_date ? formatNeeded(o.needed_for_date) : "—"}</td>
                  <td style={{ textTransform: "capitalize" }}>{o.fulfillment_type}</td>
                  <td>{o.fulfillment_status === "fulfilled" ? "fulfilled" : <span className={statusPillClass(o.status)}>{statusLabel(o.status)}</span>}</td>
                  <td className={o.paid_status === "unpaid" ? "tone-low" : ""}>{o.paid_status}</td>
                  <td className="num">${o.total}</td>
                </tr>
              ))}
              {q.isSuccess && q.data.items.length === 0 && <tr><td colSpan={7} className="muted">No matching orders.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Orders() {
  const [tab, setTab] = useState<"date" | "list">("date");
  const navigate = useNavigate();

  return (
    <div className="page">
      <PageHead title="Orders">
        <div className="tabs">
          {(["date", "list"] as const).map((t) => (
            <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
              {t === "date" ? "By date" : "List / filter"}
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={() => navigate("/orders/new")}>＋ New order</button>
      </PageHead>

      {tab === "date" ? <DateOrdersView /> : <OrdersList />}
    </div>
  );
}
