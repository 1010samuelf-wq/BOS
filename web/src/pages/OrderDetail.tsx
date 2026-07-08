// Order detail (§2A/§11): items, notes with done checkboxes + add-note, status
// pipeline, mark-paid (method), fulfill, cancel (± reverse stock), print receipt.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiRequestError } from "../api/client";
import * as api from "../api/endpoints";
import type { Order, PaymentMethod } from "../api/types";
import { ErrorMsg, Loading } from "../components/ui";

const PIPELINE: Order["status"][] = ["pending", "in_progress", "ready"];
const METHODS: PaymentMethod[] = ["cash", "card", "etransfer"];

function isOverdue(o: Order): boolean {
  return o.fulfillment_status !== "fulfilled" && o.status !== "cancelled" &&
    !!o.needed_for_date && new Date(o.needed_for_date).getTime() < Date.now();
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const orderId = Number(id);
  const navigate = useNavigate();
  const client = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reverseStock, setReverseStock] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["orders", orderId], queryFn: () => api.getOrder(orderId) });
  const invalidate = () => client.invalidateQueries({ queryKey: ["orders"] });
  const onErr = (e: unknown) => setErr(e instanceof ApiRequestError ? e.message : "Action failed.");

  const setStatus = useMutation({ mutationFn: (s: string) => api.updateOrderStatus(orderId, s), onSuccess: invalidate, onError: onErr });
  const toggleNote = useMutation({ mutationFn: (nid: number) => api.toggleOrderNote(orderId, nid), onSuccess: invalidate, onError: onErr });
  const addNote = useMutation({ mutationFn: (t: string) => api.addOrderNote(orderId, t), onSuccess: invalidate, onError: onErr });
  const markPaid = useMutation({ mutationFn: (m: string) => api.markPaid(orderId, m), onSuccess: invalidate, onError: onErr });
  const fulfill = useMutation({ mutationFn: () => api.fulfillOrder(orderId), onSuccess: invalidate, onError: onErr });
  const cancel = useMutation({ mutationFn: (rev: boolean) => api.cancelOrder(orderId, rev), onSuccess: invalidate, onError: onErr });

  if (q.isLoading) return <div className="page"><Loading /></div>;
  if (q.isError || !q.data) return <div className="page"><ErrorMsg>Couldn't load order #{orderId}.</ErrorMsg></div>;

  const o = q.data;
  const overdue = isOverdue(o);
  const fulfilLabel = o.fulfillment_type === "delivery" ? "Mark as delivered" : "Mark as picked up";

  return (
    <div className="page">
      <button className="btn neutral sm" onClick={() => navigate("/orders")}>← Orders</button>

      <div className="row" style={{ margin: "16px 0", alignItems: "flex-start" }}>
        <div style={overdue ? { borderLeft: "4px solid var(--danger)", paddingLeft: 12 } : undefined}>
          <h1 style={{ margin: 0, ...(overdue ? { color: "var(--danger)" } : {}) }}>Order #{o.id} · {o.client_name}</h1>
          <div className="muted" style={{ textTransform: "capitalize" }}>
            {o.fulfillment_type} · {o.client_phone ?? "no phone"}
            {o.needed_for_date ? ` · needed ${new Date(o.needed_for_date).toLocaleString()}` : ""}
            {overdue ? " · OVERDUE" : ""}
          </div>
          {o.locked_by != null && <div style={{ color: "var(--warn)", fontStyle: "italic" }}>Being edited on another device</div>}
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 26, fontWeight: 800 }}>${o.total}</div>
          <span className={`pill ${o.paid_status}`}>{o.paid_status.toUpperCase()}{o.payment_method ? ` · ${o.payment_method}` : ""}</span>
        </div>
      </div>

      {err && <ErrorMsg>{err}</ErrorMsg>}
      <button className="btn neutral" style={{ marginBottom: 16 }} onClick={() => api.receiptPdf(o.id).catch(onErr)}>🖨 Print receipt</button>

      {/* Items */}
      <div className="card">
        <h2>Items</h2>
        {o.items.map((it) => (
          <div key={it.id} className="row" style={{ padding: "4px 0" }}>
            <strong style={{ width: 40 }}>{it.quantity}×</strong>
            <span style={{ flex: 1 }}>{it.product_name}{it.note ? ` — ${it.note}` : ""}</span>
            <span className="muted">${it.unit_price}</span>
          </div>
        ))}
        {o.card_message && <p style={{ fontStyle: "italic" }}>🎂 “{o.card_message}”</p>}
        {o.delivery_address && <p>📍 {o.delivery_address}</p>}
      </div>

      {/* Notes */}
      <div className="card">
        <h2>Notes</h2>
        {o.notes.length === 0 && <p className="muted">No notes.</p>}
        {o.notes.map((n) => (
          <div key={n.id} className="row" style={{ padding: "4px 0", cursor: "pointer" }} onClick={() => toggleNote.mutate(n.id)}>
            <span className={`checkbox${n.done ? " on" : ""}`}>{n.done ? "✓" : ""}</span>
            <span className={n.done ? "strike" : ""}>{n.text}{n.type === "payment" ? " · payment" : ""}</span>
          </div>
        ))}
        <div className="row" style={{ marginTop: 8 }}>
          <input className="input" placeholder="Add a note…" value={newNote} onChange={(e) => setNewNote(e.target.value)} />
          <button className="btn neutral" disabled={!newNote.trim()} onClick={() => { addNote.mutate(newNote.trim()); setNewNote(""); }}>Add</button>
        </div>
      </div>

      {/* Actions */}
      {o.status !== "cancelled" && o.fulfillment_status !== "fulfilled" && (
        <div className="card">
          <h2>Progress</h2>
          <div className="row">
            {PIPELINE.map((s) => (
              <button key={s} className={`btn ${o.status === s ? "primary" : "neutral"}`} style={{ flex: 1, textTransform: "capitalize" }}
                onClick={() => setStatus.mutate(s)}>{s.replace("_", " ")}</button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
            {o.paid_status === "unpaid" && <button className="btn success" onClick={() => setPayOpen(true)}>Mark as paid</button>}
            {o.status === "ready" && <button className="btn primary" onClick={() => fulfill.mutate()}>{fulfilLabel}</button>}
            <button className="btn danger" onClick={() => setCancelOpen(true)}>Cancel order</button>
          </div>
        </div>
      )}
      {o.fulfillment_status === "fulfilled" && <p style={{ color: "var(--success)", fontWeight: 700 }}>✓ {o.fulfillment_type === "delivery" ? "Delivered" : "Picked up"}</p>}
      {o.status === "cancelled" && <p style={{ color: "var(--danger)", fontWeight: 700 }}>✕ Cancelled</p>}

      {/* Cancel dialog */}
      {cancelOpen && (
        <div className="modal-backdrop">
          <div className="card" style={{ width: 460 }}>
            <h2>Cancel order #{o.id}?</h2>
            <label className="row" style={{ cursor: "pointer", alignItems: "flex-start" }} onClick={() => setReverseStock((v) => !v)}>
              <span className={`checkbox${reverseStock ? " on" : ""}`}>{reverseStock ? "✓" : ""}</span>
              <span>Reverse stock (add deducted quantities back). Leave off if items were already made/wasted.</span>
            </label>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn neutral" onClick={() => setCancelOpen(false)}>Keep order</button>
              <button className="btn danger" onClick={() => { cancel.mutate(reverseStock); setCancelOpen(false); }}>Confirm cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Mark-paid method */}
      {payOpen && (
        <div className="modal-backdrop">
          <div className="card" style={{ width: 380 }}>
            <h2>How was it paid?</h2>
            <div className="row" style={{ justifyContent: "center" }}>
              {METHODS.map((m) => (
                <button key={m} className="btn neutral" onClick={() => { markPaid.mutate(m); setPayOpen(false); }}>
                  {m === "etransfer" ? "E-transfer" : m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            <button className="btn neutral" style={{ marginTop: 12 }} onClick={() => setPayOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
