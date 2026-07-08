// Orders (§2A/§11): a status Board (Pending/In progress/Ready) and a filterable
// List — product-name search, date range (order or needed-for), and status /
// paid / fulfillment dropdowns with Clear. Overdue rows red; click → detail.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { listOrders } from "../api/endpoints";
import type { Order, OrderStatus } from "../api/types";
import { Loading, PageHead } from "../components/ui";
import { formatNeeded, neededDeadline } from "../order/dates";

const COLUMNS: { key: OrderStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "In progress" },
  { key: "ready", label: "Ready" },
];

function isOverdue(o: Order): boolean {
  return (
    o.fulfillment_status !== "fulfilled" &&
    o.status !== "cancelled" &&
    !!o.needed_for_date &&
    neededDeadline(o.needed_for_date) < Date.now()
  );
}

function BoardCard({ o, onClick }: { o: Order; onClick: () => void }) {
  const overdue = isOverdue(o);
  const flags = o.notes.filter((n) => !n.done).length;
  return (
    <button className="order-card" style={overdue ? { borderColor: "var(--danger)", background: "#fdf1ef" } : undefined} onClick={onClick}>
      <div className="row">
        <strong style={overdue ? { color: "var(--danger)" } : undefined}>#{o.id} {o.client_name}</strong>
        {flags > 0 && <span style={{ marginLeft: "auto", color: "var(--warn)", fontSize: 12 }}>🚩{flags}</span>}
      </div>
      <div className="muted" style={{ fontSize: 13 }}>{o.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}</div>
      <div className="row" style={{ marginTop: 4 }}>
        <span className="muted" style={{ fontSize: 12, textTransform: "capitalize" }}>{o.fulfillment_type}</span>
        {o.paid_status === "unpaid" && <span className="pill unpaid" style={{ marginLeft: 4 }}>UNPAID</span>}
        <strong style={{ marginLeft: "auto" }}>${o.total}</strong>
      </div>
    </button>
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
            <option value="in_progress">In progress</option>
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
                  <td style={{ textTransform: "capitalize" }}>{o.fulfillment_status === "fulfilled" ? "fulfilled" : o.status.replace("_", " ")}</td>
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
  const [tab, setTab] = useState<"board" | "list">("board");
  const navigate = useNavigate();
  const active = useQuery({
    queryKey: ["orders", "active"],
    queryFn: () => listOrders({ limit: 100, fulfillment_status: "pending" }),
    enabled: tab === "board",
  });
  const activeOrders = (active.data?.items ?? []).filter((o) => o.status !== "cancelled");

  return (
    <div className="page">
      <PageHead title="Orders">
        <div className="tabs">
          {(["board", "list"] as const).map((t) => (
            <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
              {t === "board" ? "Board" : "List / filter"}
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={() => navigate("/orders/new")}>＋ New order</button>
      </PageHead>

      {tab === "board" ? (
        active.isLoading ? <Loading /> : (
          <div className="board">
            {COLUMNS.map((col) => {
              const cards = activeOrders.filter((o) => o.status === col.key);
              return (
                <div key={col.key} className="board-col">
                  <div className="board-col-title">{col.label} <span className="muted">{cards.length}</span></div>
                  {cards.map((o) => <BoardCard key={o.id} o={o} onClick={() => navigate(`/orders/${o.id}`)} />)}
                  {cards.length === 0 && <div className="muted" style={{ textAlign: "center" }}>—</div>}
                </div>
              );
            })}
          </div>
        )
      ) : (
        <OrdersList />
      )}
    </div>
  );
}
