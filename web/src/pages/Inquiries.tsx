// Inquiries (justcakeskosher.com public menu submissions). A customer picked
// items and asked to be called back to finalize — this is never a real Order.
// Staff open "Create order" which drops straight into the normal New Order
// screen pre-filled with their name/phone/items, ready to edit (delivery,
// payment, quantities) and submit exactly like any other order. Submitting
// automatically marks the inquiry processed. Same access as Orders.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { listInquiries, toggleInquiryHandled } from "../api/endpoints";
import type { Inquiry } from "../api/types";
import { Loading, PageHead, Tabs } from "../components/ui";

function InquiryCard({
  inq, onReopen, busy,
}: {
  inq: Inquiry;
  onReopen: () => void;
  busy: boolean;
}) {
  const navigate = useNavigate();
  const total = inq.items.reduce((s, i) => s + Number(i.unit_price) * i.quantity, 0);

  return (
    <div className="card" style={{ opacity: inq.handled ? 0.6 : 1 }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{inq.customer_name}</div>
          <a className="muted" href={`tel:${inq.customer_phone}`} style={{ fontSize: 14 }}>{inq.customer_phone}</a>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {new Date(inq.created_at).toLocaleString()}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700 }}>${total.toFixed(2)}</div>
          {inq.handled ? (
            <button className="btn neutral sm" disabled={busy} onClick={onReopen} style={{ marginTop: 6 }}>
              Reopen
            </button>
          ) : (
            <button
              className="btn primary sm"
              style={{ marginTop: 6 }}
              onClick={() => navigate("/orders/new", { state: { fromInquiry: inq } })}
            >
              Create order →
            </button>
          )}
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 14 }}>
        {inq.items.map((i) => (
          <div key={i.product_id}>{i.quantity}× {i.product_name} <span className="muted">(${i.unit_price} ea)</span></div>
        ))}
      </div>
      {inq.note && <div className="muted" style={{ marginTop: 8, fontSize: 13, fontStyle: "italic" }}>"{inq.note}"</div>}
    </div>
  );
}

export default function Inquiries() {
  const [tab, setTab] = useState<"open" | "handled" | "all">("open");
  const client = useQueryClient();
  const params = tab === "all" ? {} : { handled: tab === "handled" };
  const list = useQuery({ queryKey: ["inquiries", tab], queryFn: () => listInquiries(params) });

  const reopen = useMutation({
    mutationFn: toggleInquiryHandled,
    onSuccess: () => client.invalidateQueries({ queryKey: ["inquiries"] }),
  });

  return (
    <div className="page">
      <PageHead title="Inquiries — justcakeskosher.com">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { key: "open", label: "To process" },
            { key: "handled", label: "Processed" },
            { key: "all", label: "All" },
          ]}
        />
      </PageHead>

      {list.isLoading ? (
        <Loading />
      ) : (list.data ?? []).length === 0 ? (
        <p className="muted">{tab === "open" ? "Nothing waiting — all caught up." : "No inquiries here."}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(list.data ?? []).map((inq) => (
            <InquiryCard
              key={inq.id}
              inq={inq}
              busy={reopen.isPending && reopen.variables === inq.id}
              onReopen={() => reopen.mutate(inq.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
