// New order (§2A/§11) — full POS flow on the web: customer info, search-as-you-
// type items, per-line quantity/notes, delivery, payment (Card opens a notes
// popup), idempotent submit. All math lives in ../order/orderDraft.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ApiRequestError } from "../api/client";
import { createOrder, listProducts, searchProducts, toggleInquiryHandled } from "../api/endpoints";
import type { Inquiry, PaymentMethod, Product } from "../api/types";
import { PageHead } from "../components/ui";
import {
  addCustomItem,
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
  const [search, setSearch] = useState("");
  const [cardModal, setCardModal] = useState(false);
  const [cardNote, setCardNote] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [customSave, setCustomSave] = useState(false);
  const navigate = useNavigate();
  const client = useQueryClient();

  const results = useQuery({
    queryKey: ["product-search", search],
    queryFn: () => searchProducts(search),
    enabled: search.trim().length >= 2,
    staleTime: 30_000,
  });

  // Full active-product list for the tap-to-add grid below the search bar.
  const products = useQuery({ queryKey: ["products"], queryFn: listProducts, staleTime: 60_000 });
  const activeProducts = (products.data ?? []).filter((p) => p.active);

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
  const pick = (p: Product) => {
    setDraft((d) => addProduct(d, p));
    setSearch("");
  };
  const customPriceValid = /^\d+(\.\d{1,2})?$/.test(customPrice.trim());
  const addCustom = () => {
    if (!customName.trim() || !customPriceValid) return;
    setDraft((d) => addCustomItem(d, customName.trim(), customPrice.trim(), customSave));
    setCustomName("");
    setCustomPrice("");
    setCustomSave(false);
    setCustomOpen(false);
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

      {fromInquiry && (
        <div className="card" style={{ borderColor: "var(--primary)", background: "var(--bg-accent, #fff8f0)" }}>
          <strong>From a justcakeskosher.com inquiry</strong> — review and edit as needed, then submit like any order.
        </div>
      )}

      {/* Customer & order info */}
      <div className="card">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input className="input" style={{ flex: 2, minWidth: 200 }} placeholder="Client name *"
            value={draft.clientName} onChange={(e) => set({ clientName: e.target.value })} />
          <input className="input" style={{ maxWidth: 160 }} placeholder="Phone"
            value={draft.clientPhone} onChange={(e) => set({ clientPhone: e.target.value })} />
          {(() => {
            const nd = draft.neededFor ? draft.neededFor.split("T")[0] : "";
            const nt = draft.neededFor?.includes("T") ? draft.neededFor.split("T")[1].slice(0, 5) : "";
            return (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span className="muted" style={{ fontSize: 11 }}>Needed for (date)</span>
                  <input className="input" type="date" style={{ maxWidth: 160 }} value={nd}
                    onChange={(e) => set({ neededFor: e.target.value ? (nt ? `${e.target.value}T${nt}` : e.target.value) : null })} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span className="muted" style={{ fontSize: 11 }}>Time (optional)</span>
                  <input className="input" type="time" style={{ maxWidth: 130 }} value={nt} disabled={!nd}
                    title={!nd ? "Pick a date first" : ""}
                    onChange={(e) => set({ neededFor: nd ? (e.target.value ? `${nd}T${e.target.value}` : nd) : null })} />
                </label>
              </>
            );
          })()}
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
              <input className="input" style={{ maxWidth: 180 }} placeholder="Delivery name (recipient)"
                value={draft.deliveryName} onChange={(e) => set({ deliveryName: e.target.value })} />
              <input className="input" style={{ maxWidth: 130 }} placeholder="Delivery $"
                value={draft.deliveryPrice} onChange={(e) => set({ deliveryPrice: e.target.value })} />
              <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Delivery address *"
                value={draft.deliveryAddress} onChange={(e) => set({ deliveryAddress: e.target.value })} />
            </>
          )}
        </div>
        <input className="input" style={{ marginTop: 12 }} placeholder="Card message"
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

        {/* Tap-to-add: all active products, so staff don't have to search each one. */}
        {activeProducts.length > 0 && (
          <div className="product-grid">
            {activeProducts.map((p) => (
              <button key={p.id} type="button" className="product-chip" title={`Add ${p.name}`}
                onClick={() => setDraft((d) => addProduct(d, p))}>
                {p.photo_url
                  ? <img src={p.photo_url} alt="" className="thumb" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  : <span className="thumb thumb-empty">📷</span>}
                <span className="product-chip-name">{p.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>${p.price}</span>
              </button>
            ))}
          </div>
        )}

        {!customOpen ? (
          <button className="btn neutral sm" style={{ marginTop: 8 }} onClick={() => setCustomOpen(true)}>
            + Custom item
          </button>
        ) : (
          <div className="row" style={{ flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
            <input className="input" placeholder="Item name" value={customName}
              onChange={(e) => setCustomName(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
            <input className="input" placeholder="Price" value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)} style={{ maxWidth: 100 }} />
            <label className="row" style={{ gap: 6, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={customSave} onChange={(e) => setCustomSave(e.target.checked)} />
              Save as a regular product
            </label>
            <button className="btn primary sm" disabled={!customName.trim() || !customPriceValid} onClick={addCustom}>
              Add
            </button>
            <button className="btn neutral sm" onClick={() => { setCustomOpen(false); setCustomName(""); setCustomPrice(""); setCustomSave(false); }}>
              Cancel
            </button>
          </div>
        )}

        {draft.lines.length === 0 ? (
          <p className="muted" style={{ textAlign: "center" }}>No items yet — tap a product above or search.</p>
        ) : (
          draft.lines.map((l, i) => (
            <div key={`${l.product_id}-${i}`} className="row" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {l.product_name}
                  {l.product_id === null && <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}> · custom{l.saveAsProduct ? ", saved" : ""}</span>}
                </div>
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
