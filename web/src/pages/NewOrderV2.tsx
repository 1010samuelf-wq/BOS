// New order — the alternative layout.
//
// Same data, same validation, same submit as the classic form; this is only a
// different arrangement of it. It exists alongside rather than replacing, so
// staff can switch back mid-shift if it doesn't suit them.
//
// What's different, and why:
//
// * **Sections are named.** The classic form is four unlabelled cards, so you
//   work out what each one is from the fields inside it. "Customer", "When and
//   where", "Items", "Payment" does most of the work on its own.
// * **Who, when and where are separated.** They were six inputs in one row.
// * **The total and Submit are always on screen**, pinned to the bottom,
//   instead of being the end of a scroll.
// * **Colour means something.** Brand colour is reserved for the total and the
//   submit; the warning tone is reserved for "this will be unpaid". Everything
//   else is quiet, so the two things worth noticing stand out.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ApiRequestError } from "../api/client";
import { createOrder, toggleInquiryHandled } from "../api/endpoints";
import type { Inquiry, PaymentMethod } from "../api/types";
import CustomerPicker from "../components/CustomerPicker";
import { PageHead, SwitchChoice } from "../components/ui";
import { OrderItemsEditor } from "../order/OrderFormFields";
import { withCents } from "../order/money";
import {
  buildPayload,
  draftTotal,
  emptyDraft,
  validateDraft,
  type Draft,
} from "../order/orderDraft";
import { useOrderFormView } from "../order/useFormView";

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

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="ov2-section">
      <div className="ov2-section-head">
        <h2>{title}</h2>
        {hint && <span className="muted">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children, grow }: { label: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <label className="ov2-field" style={grow ? { flex: 1, minWidth: 180 } : undefined}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function NewOrderV2() {
  const location = useLocation();
  const fromInquiry = (location.state as { fromInquiry?: Inquiry } | null)?.fromInquiry ?? null;
  const [draft, setDraft] = useState<Draft>(() => (fromInquiry ? draftFromInquiry(fromInquiry) : emptyDraft()));
  const [cardModal, setCardModal] = useState(false);
  const [cardNote, setCardNote] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [, setView] = useOrderFormView();
  const navigate = useNavigate();
  const client = useQueryClient();

  const submit = useMutation({
    mutationFn: createOrder,
    onSuccess: async () => {
      client.invalidateQueries({ queryKey: ["orders"] });
      if (fromInquiry && !fromInquiry.handled) {
        try { await toggleInquiryHandled(fromInquiry.id); } catch { /* the order exists either way */ }
        client.invalidateQueries({ queryKey: ["inquiries"] });
      }
      navigate("/orders");
    },
    onError: (e) => setProblems([e instanceof ApiRequestError ? e.message : "Could not submit."]),
  });

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const chooseMethod = (m: PaymentMethod) => {
    set({ paymentMethod: m });
    if (m === "card") { setCardNote(draft.cardPaymentNote); setCardModal(true); }
  };
  const onSubmit = () => {
    const found = validateDraft(draft);
    setProblems(found);
    if (found.length === 0) submit.mutate(buildPayload(draft));
  };

  const nd = draft.neededFor ? draft.neededFor.split("T")[0] : "";
  const nt = draft.neededFor?.includes("T") ? draft.neededFor.split("T")[1].slice(0, 5) : "";
  const lineCount = draft.lines.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <div className="page ov2">
      <PageHead title="New order">
        <SwitchChoice
          value="new"
          onChange={(v) => setView(v === "new" ? "new" : "classic")}
          title="Switch between the classic order form and this one. Your choice sticks on this device."
          options={[
            { key: "classic", label: "Classic" },
            { key: "new", label: "New" },
          ] as const}
        />
      </PageHead>

      {fromInquiry && (
        <div className="ov2-banner">
          <strong>From a justcakeskosher.com inquiry</strong> — check it over, then submit like any order.
        </div>
      )}

      <Section title="Customer">
        <div className="ov2-row">
          <div style={{ flex: 2, minWidth: 220 }}>
            <Field label="Name *">
              <CustomerPicker
                name={draft.clientName}
                onNameChange={(v) => set({ clientName: v })}
                onPick={(c) => set({
                  clientName: c.name,
                  clientPhone: draft.clientPhone || c.phone || "",
                  deliveryAddress: draft.deliveryAddress || c.address || "",
                })}
              />
            </Field>
          </div>
          <Field label="Phone" grow>
            <input className="input" value={draft.clientPhone}
              onChange={(e) => set({ clientPhone: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section title="When and where">
        <div className="ov2-row">
          <Field label="Needed for">
            <input className="input" type="date" value={nd} style={{ maxWidth: 170 }}
              onChange={(e) => set({ neededFor: e.target.value ? (nt ? `${e.target.value}T${nt}` : e.target.value) : null })} />
          </Field>
          <Field label="Time (optional)">
            <input className="input" type="time" value={nt} disabled={!nd} style={{ maxWidth: 140 }}
              title={!nd ? "Pick a date first" : ""}
              onChange={(e) => set({ neededFor: nd ? (e.target.value ? `${nd}T${e.target.value}` : nd) : null })} />
          </Field>
          <Field label="How they get it">
            <SwitchChoice
              value={draft.fulfillment}
              onChange={(f) => set({ fulfillment: f })}
              options={[
                { key: "pickup", label: "Pickup" },
                { key: "delivery", label: "Delivery" },
              ] as const}
            />
          </Field>
        </div>

        {draft.fulfillment === "delivery" && (
          <div className="ov2-row ov2-delivery">
            <Field label="Address *" grow>
              <input className="input" value={draft.deliveryAddress}
                onChange={(e) => set({ deliveryAddress: e.target.value })} />
            </Field>
            <Field label="Recipient">
              <input className="input" style={{ maxWidth: 180 }} value={draft.deliveryName}
                onChange={(e) => set({ deliveryName: e.target.value })} />
            </Field>
            <Field label="Delivery charge">
              <input className="input" style={{ maxWidth: 120 }} value={draft.deliveryPrice}
                onChange={(e) => set({ deliveryPrice: e.target.value })}
                onBlur={() => set({ deliveryPrice: withCents(draft.deliveryPrice) })} />
            </Field>
          </div>
        )}
      </Section>

      <Section title="Items" hint={lineCount > 0 ? `${lineCount} item${lineCount === 1 ? "" : "s"}` : undefined}>
        {/* The picker is reused wholesale — search, categories and custom items
            already work, and rebuilding them would only add bugs. */}
        <OrderItemsEditor draft={draft} setDraft={setDraft} />
      </Section>

      <Section title="Note" hint="Anything the baker or driver should know">
        <textarea className="input" rows={2}
          placeholder='e.g. "they come and sit" — one per line'
          value={draft.generalNotes} onChange={(e) => set({ generalNotes: e.target.value })} />
      </Section>

      <Section title="Payment">
        <div className="ov2-row">
          <Field label="When">
            <SwitchChoice
              value={draft.paymentTiming}
              onChange={(t) => set({ paymentTiming: t, paymentMethod: null })}
              options={[
                { key: "now", label: "Pay now" },
                { key: "later", label: "Pay later" },
              ] as const}
            />
          </Field>

          {draft.paymentTiming === "now" ? (
            <Field label="Method *">
              <div className="ov2-methods">
                {METHODS.map((m) => (
                  <button key={m.key}
                    className={`btn ${draft.paymentMethod === m.key ? "primary" : "neutral"}`}
                    onClick={() => chooseMethod(m.key)}>{m.label}</button>
                ))}
              </div>
            </Field>
          ) : (
            <Field label="Expecting (optional)">
              <div className="ov2-methods">
                {METHODS.map((m) => (
                  <button key={m.key}
                    className={`btn ${draft.expectedPaymentMethod === m.key ? "primary" : "neutral"}`}
                    onClick={() => set({
                      expectedPaymentMethod: draft.expectedPaymentMethod === m.key ? null : m.key,
                    })}>{m.label}</button>
                ))}
              </div>
            </Field>
          )}
        </div>

        {draft.paymentTiming === "later" && (
          <p className="ov2-unpaid">This order will be saved as <strong>unpaid</strong>.</p>
        )}
      </Section>

      {problems.length > 0 && (
        <div className="ov2-problems">
          {problems.map((p) => <p key={p}>• {p}</p>)}
        </div>
      )}

      {/* Pinned: the two things you always want in reach. */}
      <div className="ov2-bar">
        <div className="ov2-bar-inner">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Total</div>
            <div className="ov2-total">${draftTotal(draft)}</div>
          </div>
          {draft.paymentTiming === "later" && <span className="pill unpaid">UNPAID</span>}
          <button className="btn primary ov2-submit" disabled={submit.isPending} onClick={onSubmit}>
            {submit.isPending ? "Submitting…" : "Submit order"}
          </button>
        </div>
      </div>

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
