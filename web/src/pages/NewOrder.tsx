// New order (§2A/§11) — full POS flow on the web: customer info, search-as-you-
// type items, per-line quantity/notes, delivery, payment (Card opens a notes
// popup), idempotent submit. All math lives in ../order/orderDraft.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiRequestError } from "../api/client";
import { createOrder, searchProducts } from "../api/endpoints";
import type { PaymentMethod, Product } from "../api/types";
import { PageHead } from "../components/ui";
import {
  addProduct,
  buildPayload,
  draftTotal,
  emptyDraft,
  lineTotal,
  removeLine,
  setLineNote,
  setQuantity,
  validateDraft,
  type Draft,
} from "../order/orderDraft";

const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "etransfer", label: "E-transfer" },
];

export default function NewOrder() {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [search, setSearch] = useState("");
  const [cardModal, setCardModal] = useState(false);
  const [cardNote, setCardNote] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const navigate = useNavigate();
  const client = useQueryClient();

  const results = useQuery({
    queryKey: ["product-search", search],
    queryFn: () => searchProducts(search),
    enabled: search.trim().length >= 2,
    staleTime: 30_000,
  });

  const submit = useMutation({
    mutationFn: createOrder,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["orders"] });
      navigate("/orders");
    },
    onError: (e) => setProblems([e instanceof ApiRequestError ? e.message : "Could not submit."]),
  });

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const pick = (p: Product) => {
    setDraft((d) => addProduct(d, p));
    setSearch("");
  };
  const chooseMethod = (m: PaymentMethod) => {
    set({ paymentMethod: m });
    if (m === "card") {
      setCardNote(draft.cardPaymentNote);
      setCardModal(true);
    }
  };
  const onSubmit = () => {
    const p = validateDraft(draft);
    setProblems(p);
    if (p.length === 0) submit.mutate(buildPayload(draft));
  };

  return (
    <div className="page">
      <PageHead title="New order" />

      {/* Customer & order info */}
      <div className="card">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input className="input" style={{ flex: 2, minWidth: 200 }} placeholder="Client name *"
            value={draft.clientName} onChange={(e) => set({ clientName: e.target.value })} />
          <input className="input" style={{ maxWidth: 160 }} placeholder="Phone"
            value={draft.clientPhone} onChange={(e) => set({ clientPhone: e.target.value })} />
          <input className="input" style={{ maxWidth: 210 }} placeholder="Needed for (YYYY-MM-DD HH:MM)"
            value={draft.neededFor ?? ""} onChange={(e) => set({ neededFor: e.target.value.trim() ? e.target.value.replace(" ", "T") : null })} />
        </div>
        <div className="row" style={{ flexWrap: "wrap", marginTop: 12 }}>
          <div className="tabs">
            {(["pickup", "delivery"] as const).map((f) => (
              <button key={f} className={`tab${draft.fulfillment === f ? " active" : ""}`} onClick={() => set({ fulfillment: f })}>
                {f === "pickup" ? "Pickup" : "Delivery"}
              </button>
            ))}
          </div>
          {draft.fulfillment === "delivery" && (
            <>
              <input className="input" style={{ maxWidth: 130 }} placeholder="Delivery $"
                value={draft.deliveryPrice} onChange={(e) => set({ deliveryPrice: e.target.value })} />
              <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Delivery address *"
                value={draft.deliveryAddress} onChange={(e) => set({ deliveryAddress: e.target.value })} />
            </>
          )}
        </div>
        <input className="input" style={{ marginTop: 12 }} placeholder="Card message (written on the cake/card)"
          value={draft.cardMessage} onChange={(e) => set({ cardMessage: e.target.value })} />
      </div>

      {/* Items */}
      <div className="card">
        <div style={{ position: "relative" }}>
          <input className="input" placeholder='Search products… (e.g. "cro")' value={search}
            onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
          {search.trim().length >= 2 && (
            <div className="dropdown">
              {(results.data ?? []).map((p) => (
                <button key={p.id} className="dropdown-row" onClick={() => pick(p)}>
                  <span style={{ display: "flex", alignItems: "center" }}>
                    {p.photo_url
                      ? <img src={p.photo_url} alt="" className="thumb" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                      : <span className="thumb thumb-empty">📷</span>}
                    {p.name}
                  </span>
                  <span className="muted">${p.price}</span>
                </button>
              ))}
              {results.isSuccess && results.data.length === 0 && <div style={{ padding: 10 }} className="muted">No matches</div>}
            </div>
          )}
        </div>
        {draft.lines.length === 0 ? (
          <p className="muted" style={{ textAlign: "center" }}>No items yet — search above to add.</p>
        ) : (
          draft.lines.map((l, i) => (
            <div key={`${l.product_id}-${i}`} className="row" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{l.product_name}</div>
                <input className="input" style={{ marginTop: 4, padding: "4px 8px" }} placeholder="Note for this item…"
                  value={l.note} onChange={(e) => setDraft((d) => setLineNote(d, i, e.target.value))} />
              </div>
              <div className="row">
                <button className="btn neutral sm" onClick={() => setDraft((d) => setQuantity(d, i, l.quantity - 1))}>−</button>
                <input className="input" style={{ width: 52, textAlign: "center" }} value={l.quantity}
                  onChange={(e) => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) setDraft((d) => setQuantity(d, i, n)); }} />
                <button className="btn neutral sm" onClick={() => setDraft((d) => setQuantity(d, i, l.quantity + 1))}>+</button>
              </div>
              <div style={{ width: 70, textAlign: "right", fontWeight: 700 }}>${lineTotal(l)}</div>
              <button className="btn neutral sm" onClick={() => setDraft((d) => removeLine(d, i))}>✕</button>
            </div>
          ))
        )}
      </div>

      {/* Order notes */}
      <div className="card">
        <textarea className="input" rows={2} placeholder='Order note (e.g. "they come and sit") — one per line'
          value={draft.generalNotes} onChange={(e) => set({ generalNotes: e.target.value })} />
      </div>

      {/* Payment */}
      <div className="card">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <div className="tabs">
            {(["now", "later"] as const).map((t) => (
              <button key={t} className={`tab${draft.paymentTiming === t ? " active" : ""}`}
                onClick={() => set({ paymentTiming: t, paymentMethod: null })}>
                {t === "now" ? "Pay now" : "Pay later"}
              </button>
            ))}
          </div>
          {draft.paymentTiming === "now" ? (
            <div className="row">
              {METHODS.map((m) => (
                <button key={m.key} className={`btn ${draft.paymentMethod === m.key ? "primary" : "neutral"} sm`}
                  onClick={() => chooseMethod(m.key)}>{m.label}</button>
              ))}
            </div>
          ) : (
            <span className="pill unpaid">Will be marked UNPAID</span>
          )}
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div className="muted" style={{ fontSize: 12 }}>Total</div>
            <div style={{ fontSize: 26, fontWeight: 800 }}>${draftTotal(draft)}</div>
          </div>
        </div>
        {problems.map((p) => <p key={p} className="error">• {p}</p>)}
        <button className="btn primary" style={{ marginTop: 8 }} disabled={submit.isPending} onClick={onSubmit}>
          {submit.isPending ? "Submitting…" : "Submit order"}
        </button>
      </div>

      {/* Card payment-notes popup */}
      {cardModal && (
        <div className="modal-backdrop">
          <div className="card" style={{ width: 420 }}>
            <h2>Card payment notes</h2>
            <textarea className="input" rows={3} placeholder="Terminal ref, last 4 digits, approval code…"
              value={cardNote} onChange={(e) => setCardNote(e.target.value)} autoFocus />
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn neutral" onClick={() => setCardModal(false)}>Cancel</button>
              <button className="btn primary" onClick={() => { set({ cardPaymentNote: cardNote }); setCardModal(false); }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
