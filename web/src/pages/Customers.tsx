// Customers: who has ordered, what they ordered, and what they've spent.
//
// The merge control is here because the automatic matching deliberately errs
// toward leaving two records rather than risking filing an order under the
// wrong person — so the cleanup has to be a two-click job, not a support call.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { getCustomer, listCustomers, mergeCustomers, updateCustomer } from "../api/endpoints";
import type { Customer } from "../api/types";
import { Loading, PageHead } from "../components/ui";
import { formatDate, formatNeeded } from "../order/dates";

function Detail({ id, onMergeInto }: { id: number; onMergeInto: (c: Customer) => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "", notes: "" });

  const q = useQuery({ queryKey: ["customers", id], queryFn: () => getCustomer(id) });

  const save = useMutation({
    mutationFn: () => updateCustomer(id, form),
    onSuccess: () => {
      setEditing(false);
      client.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  if (q.isLoading || !q.data) return <Loading />;
  const c = q.data;

  return (
    <div className="card">
      <div className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          {editing ? (
            <div className="row" style={{ flexWrap: "wrap" }}>
              <input className="input" style={{ maxWidth: 200 }} placeholder="Name"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="input" style={{ maxWidth: 160 }} placeholder="Phone"
                value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Usual address"
                value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
          ) : (
            <>
              <h2 style={{ margin: 0 }}>{c.name}</h2>
              <div className="muted" style={{ fontSize: 13 }}>
                {c.phone ? <a href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`}>{c.phone}</a> : "no phone"}
                {c.address ? ` · ${c.address}` : ""}
              </div>
            </>
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {editing ? (
            <>
              <button className="btn neutral sm" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn primary sm" disabled={save.isPending}
                onClick={() => save.mutate()}>Save</button>
            </>
          ) : (
            <>
              <button className="btn neutral sm" onClick={() => {
                setForm({
                  name: c.name, phone: c.phone ?? "",
                  address: c.address ?? "", notes: c.notes ?? "",
                });
                setEditing(true);
              }}>Edit</button>
              <button className="btn neutral sm" onClick={() => onMergeInto(c)}>
                Merge a duplicate in
              </button>
            </>
          )}
        </div>
      </div>

      <div className="row" style={{ marginTop: 14, gap: 24 }}>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Paid orders</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{c.order_count}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Lifetime value</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>${c.lifetime_value}</div>
        </div>
      </div>

      <h3 style={{ fontSize: 14, marginTop: 18, marginBottom: 6 }}>Order history</h3>
      {c.orders.length === 0 ? (
        <p className="muted">No orders yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Order</th><th>Date</th><th>Needed</th><th>For</th>
              <th>Items</th><th>Paid</th><th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {c.orders.map((o) => (
              <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/orders/${o.id}`)}>
                <td>#{o.id}</td>
                <td>{formatDate(new Date(o.order_date))}</td>
                <td>{o.needed_for_date ? formatNeeded(o.needed_for_date) : "—"}</td>
                <td>{o.for_whom || "—"}</td>
                <td className="muted wrap">{o.items}</td>
                <td className={o.paid_status === "unpaid" ? "tone-low" : ""}>{o.paid_status}</td>
                <td className="num">${o.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Customers() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Customer | null>(null);
  const client = useQueryClient();

  const list = useQuery({ queryKey: ["customers", "list", q], queryFn: () => listCustomers(q) });

  const merge = useMutation({
    mutationFn: ({ keep, source }: { keep: number; source: number }) =>
      mergeCustomers(keep, source),
    onSuccess: (out) => {
      setMergeTarget(null);
      setSelected(out.id);
      client.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  return (
    <div className="page">
      <PageHead title="Customers">
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search name or phone…"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </PageHead>

      {mergeTarget && (
        <div className="card" style={{ borderColor: "var(--warn)" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Merge a duplicate into {mergeTarget.name}
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Pick the record that shouldn't exist. Its orders move to{" "}
            <strong>{mergeTarget.name}</strong> and it disappears. This can't be undone —
            if two different people were merged by mistake, you'd have to move their
            orders back one at a time.
          </p>
          {merge.isError && (
            <p className="tone-low" style={{ fontSize: 13 }}>That merge didn't go through.</p>
          )}
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {(list.data ?? [])
              .filter((c) => c.id !== mergeTarget.id)
              .map((c) => (
                <button key={c.id} className="btn neutral sm" disabled={merge.isPending}
                  onClick={() => merge.mutate({ keep: mergeTarget.id, source: c.id })}>
                  {c.name}{c.phone ? ` · ${c.phone}` : ""}
                </button>
              ))}
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
            <button className="btn neutral sm" onClick={() => setMergeTarget(null)}>Cancel</button>
          </div>
        </div>
      )}

      {selected !== null && (
        <>
          <button className="btn neutral sm" style={{ marginBottom: 10 }}
            onClick={() => setSelected(null)}>← All customers</button>
          <Detail id={selected} onMergeInto={setMergeTarget} />
        </>
      )}

      {selected === null && (
        list.isLoading ? <Loading /> : (
          <div className="card">
            <table>
              <thead><tr><th>Name</th><th>Phone</th><th>Usual address</th></tr></thead>
              <tbody>
                {(list.data ?? []).map((c) => (
                  <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setSelected(c.id)}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td>{c.phone || "—"}</td>
                    <td className="muted wrap">{c.address || "—"}</td>
                  </tr>
                ))}
                {list.isSuccess && list.data.length === 0 && (
                  <tr><td colSpan={3} className="muted">No customers match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
