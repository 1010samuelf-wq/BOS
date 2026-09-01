// Orders (§2A/§11). Two views, and the difference between them is the whole
// point of the labelling here:
//
//   "Coming up"  — only orders still to be made or handed over, bucketed by the
//                  day they're needed (Today / Tomorrow / This week / a custom
//                  range / All).
//   "All orders" — every order ever, finished and cancelled included, with
//                  product search, a date range and the status dropdowns.
//
// They used to be called "By date" and "List / filter", which described the
// controls rather than the contents; staff couldn't tell what set of orders
// each one was showing, and asked outright how a custom range differed from the
// filter tab and where to see everything. Both views now say what they hold.
//
// Overdue rows red; click → detail. Orders with no needed-for date always show
// (nothing to bucket them into) rather than silently disappearing under a preset.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { listOrders } from "../api/endpoints";
import type { Order, OrderStatus } from "../api/types";
import { LoadFailed, Loading, PageHead, Tabs, isStalled } from "../components/ui";
import { asDate, formatNeeded, neededDeadline } from "../order/dates";

function isOverdue(o: Order): boolean {
  return (
    o.fulfillment_status !== "fulfilled" &&
    o.status !== "cancelled" &&
    !!o.needed_for_date &&
    neededDeadline(o.needed_for_date) < Date.now()
  );
}

// Overdue (late) beats ready (done) — a ready order past its needed time is
// still a problem worth flagging red, not green.
function rowClass(o: Order): string {
  if (isOverdue(o)) return "overdue";
  if (o.status === "ready") return "row-ready";
  return "";
}

function statusLabel(s: OrderStatus): string {
  return s === "in_progress" ? "In progress" : s;
}
function statusPillClass(s: OrderStatus): string {
  if (s === "ready") return "pill status-ready";
  if (s === "in_progress") return "pill status-progress";
  return "pill status-pending";
}

type DatePreset = "today" | "tomorrow" | "week" | "custom" | "all";

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
  // "All" means no date filtering at all, which is a different thing from a
  // very wide range — hence null rather than sentinel dates.
  const range =
    preset === "all" ? null
    : preset === "custom" ? { from: customFrom, to: customTo }
    : presetRange(preset);

  const q = useQuery({
    queryKey: ["orders", "outstanding"],
    queryFn: () => listOrders({ limit: 200, fulfillment_status: "pending", exclude_cancelled: true }),
  });

  const rows = (q.data?.items ?? [])
    .filter((o) => {
      if (range === null) return true;     // "All" — every outstanding order
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
              { key: "all", label: "All" },
            ]}
          />
          {preset === "custom" && (
            <>
              <input className="input" type="date" style={{ maxWidth: 150 }} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <input className="input" type="date" style={{ maxWidth: 150 }} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </>
          )}
        </div>
        <p className="view-note">
          Orders still to make or hand over, by the day they're needed.
          Finished and cancelled orders are under <strong>All orders</strong>.
        </p>
      </div>

      {q.isLoading ? (
        <Loading />
      ) : isStalled(q) ? (
        <LoadFailed what="orders" onRetry={() => void q.refetch()} />
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
                <tr key={o.id} className={rowClass(o)} style={{ cursor: "pointer" }} onClick={() => navigate(`/orders/${o.id}`)}>
                  <td>#{o.id}</td>
                  <td>{o.client_name}</td>
                  <td>{o.needed_for_date ? formatNeeded(o.needed_for_date) : "No date set"}</td>
                  <td className="muted wrap">{o.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}</td>
                  <td style={{ textTransform: "capitalize" }}>{o.fulfillment_type}</td>
                  <td><span className={statusPillClass(o.status)}>{statusLabel(o.status)}</span></td>
                  <td><span className={`pill ${o.paid_status}`}>{o.paid_status}</span></td>
                  <td className="num">${o.total}</td>
                </tr>
              ))}
              {q.isSuccess && rows.length === 0 && (
                <tr><td colSpan={8} className="muted">
                  {preset === "all" ? "Nothing outstanding — everything is fulfilled." : "No orders in this range."}
                </td></tr>
              )}
              {/* Saying "All" and then quietly stopping at the fetch limit would
                  reintroduce the very complaint this preset answers. */}
              {q.isSuccess && q.data.total > q.data.items.length && (
                <tr><td colSpan={8} className="muted">
                  Showing the first {q.data.items.length} of {q.data.total} outstanding orders —
                  narrow the range to see the rest.
                </td></tr>
              )}
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
  // Soonest-needed first by default: this list is read to find what's coming
  // up, and the table's date column is "Needed for". Sorting happens on the
  // server, so it holds across the whole result set and not just the page
  // that got fetched.
  sort: "needed_asc",
};

function OrdersList() {
  const navigate = useNavigate();
  const [f, setF] = useState(EMPTY);
  const set = (patch: Partial<typeof EMPTY>) => setF((cur) => ({ ...cur, ...patch }));
  // "Clear" lights up whenever anything differs from the defaults — comparing
  // against EMPTY directly keeps this honest as fields are added.
  const active = Object.entries(f).some(([k, v]) => v !== EMPTY[k as keyof typeof EMPTY]);

  const q = useQuery({
    queryKey: ["orders", "list", f],
    queryFn: () => listOrders({
      limit: 200,
      product_name: f.product_name || undefined,
      date_field: f.date_field,
      sort: f.sort,
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
          <select className="input" style={{ maxWidth: 190 }} value={f.sort} onChange={(e) => set({ sort: e.target.value })}>
            <option value="needed_asc">Needed date ↑ (soonest)</option>
            <option value="needed_desc">Needed date ↓ (latest)</option>
            <option value="order_desc">Order date ↓ (newest)</option>
            <option value="order_asc">Order date ↑ (oldest)</option>
          </select>
          <button className="btn neutral" disabled={!active} onClick={() => setF(EMPTY)}>Clear</button>
        </div>
        <p className="view-note">
          Every order, finished and cancelled included. With nothing filled in
          it shows the lot, newest-needed first.
        </p>
      </div>

      {q.isLoading ? <Loading /> : isStalled(q) ? (
        <LoadFailed what="orders" onRetry={() => void q.refetch()} />
      ) : (
        <div className="card">
          <table>
            <thead><tr><th>Order</th><th>Client</th><th>Needed for</th><th>Type</th><th>Status</th><th>Paid</th><th className="num">Total</th></tr></thead>
            <tbody>
              {(q.data?.items ?? []).map((o) => (
                <tr key={o.id} className={rowClass(o)} style={{ cursor: "pointer" }} onClick={() => navigate(`/orders/${o.id}`)}>
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
              {q.isSuccess && q.data.total > q.data.items.length && (
                <tr><td colSpan={7} className="muted">
                  Showing the first {q.data.items.length} of {q.data.total} matching orders —
                  add a filter to narrow it down.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NotFulfilledCount() {
  // limit: 1 — only the total from the pagination envelope is needed, not
  // the rows themselves, so this stays cheap regardless of backlog size.
  const q = useQuery({
    queryKey: ["orders", "not-fulfilled-count"],
    queryFn: () => listOrders({ limit: 1, fulfillment_status: "pending", exclude_cancelled: true }),
  });
  if (q.isLoading || q.data === undefined) return null;
  return (
    <span className="pill status-pending" style={{ fontSize: 13 }}>
      {q.data.total} orders
    </span>
  );
}

export default function Orders() {
  const [tab, setTab] = useState<"date" | "list">("date");
  const navigate = useNavigate();

  return (
    <div className="page">
      <PageHead title="Orders">
        <NotFulfilledCount />
        <div className="tabs">
          {(["date", "list"] as const).map((t) => (
            <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
              {t === "date" ? "Coming up" : "All orders"}
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={() => navigate("/orders/new")}>＋ New order</button>
      </PageHead>

      {tab === "date" ? <DateOrdersView /> : <OrdersList />}
    </div>
  );
}
