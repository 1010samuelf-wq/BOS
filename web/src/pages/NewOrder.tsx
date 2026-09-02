// New order (§2A/§11) — full POS flow on the web: customer info, search-as-you-
// type items, per-line quantity/notes, delivery, payment (Card opens a notes
// popup), idempotent submit. Header/items UI lives in ../order/OrderFormFields
// (shared with Order Detail's edit mode); all math lives in ../order/orderDraft.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ApiRequestError } from "../api/client";
import { createOrder, toggleInquiryHandled } from "../api/endpoints";
import type { Inquiry, PaymentMethod } from "../api/types";
import { PageHead } from "../components/ui";
import { OrderHeaderFields, OrderItemsEditor } from "../order/OrderFormFields";
import {
  buildPayload,
  draftTotal,
  emptyDraft,
  validateDraft,
  type Draft,
} from "../order/orderDraft";

/** Prefill a draft from an Inquiries "Create order" hand-off — same shape as
 * a normal draft, just seeded with what the customer picked on the menu site. */
function draftFromInquiry(inq: Inquiry): Draft {
  const base = emptyDraft();
  return {
    ...base,
    clientName: inq.customer_name,
    clientPhone: inq.customer_phone,
    generalNotes: inq.note ?? "",
    lines: inq.items.map((i) => ({
      product_id: i.product_id,
      product_name: i.product_name,
      unit_price: i.unit_price,
      quantity: i.quantity,
      note: "",
    })),
  };
}

const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "etransfer", label: "E-transfer" },
];

export default function NewOrder() {
  const location = useLocation();
  const fromInquiry = (location.state as { fromInquiry?: Inquiry } | null)?.fromInquiry ?? null;
  const [draft, setDraft] = useState<Draft>(() => (fromInquiry ? draftFromInquiry(fromInquiry) : emptyDraft()));
  const [cardModal, setCardModal] = useState(false);
  const [cardNote, setCardNote] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const navigate = useNavigate();
  const client = useQueryClient();

  const submit = useMutation({
    mutationFn: createOrder,
    onSuccess: async () => {
      client.invalidateQueries({ queryKey: ["orders"] });
      if (fromInquiry && !fromInquiry.handled) {
        try { await toggleInquiryHandled(fromInquiry.id); } catch { /* order is created either way; not fatal */ }
        client.invalidateQueries({ queryKey: ["inquiries"] });
      }
      navigate("/orders");
    },
    onError: (e) => setProblems([e instanceof ApiRequestError ? e.message : "Could not submit."]),
  });

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
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

      {fromInquiry && (
        <div className="card" style={{ borderColor: "var(--primary)", background: "var(--bg-accent, #fff8f0)" }}>
          <strong>From a justcakeskosher.com inquiry</strong> — review and edit as needed, then submit like any order.
        </div>
      )}

      <OrderHeaderFields draft={draft} set={set} />
      <OrderItemsEditor draft={draft} setDraft={setDraft} />

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
            <div className="row" style={{ flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span className="pill unpaid">Will be marked UNPAID</span>
              {/* How they said they'll pay. Optional, and it settles nothing —
                  it just means the day can be planned around what's coming in,
                  and marking it paid later defaults to this. */}
              <span className="muted" style={{ fontSize: 13 }}>Expecting</span>
              {METHODS.map((m) => (
                <button
                  key={m.key}
                  className={`btn ${draft.expectedPaymentMethod === m.key ? "primary" : "neutral"} sm`}
                  onClick={() =>
                    set({ expectedPaymentMethod: draft.expectedPaymentMethod === m.key ? null : m.key })
                  }
                >
                  {m.label}
                </button>
              ))}
            </div>
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
