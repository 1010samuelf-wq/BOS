// One company's ledger: running balance up top, dated entries below, and a
// form to log a new charge (money now owed) or payment (money settled).
//
// Every line is editable in place, and so is the company itself. A ledger gets
// typed at speed at a counter — a wrong date or a transposed amount is normal,
// and the alternative to editing was delete-and-retype, which loses who logged
// it and when.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiRequestError } from "../api/client";
import {
  addLedgerEntry,
  deleteLedgerEntry,
  getCompany,
  updateCompany,
  updateLedgerEntry,
} from "../api/endpoints";
import type { CompanyType, LedgerEntry, LedgerEntryType } from "../api/types";
import { ErrorMsg, LoadFailed, Loading, isStalled } from "../components/ui";
import { formatDate } from "../order/dates";

const todayInput = () => new Date().toISOString().slice(0, 10);
const validAmount = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim()) && Number(v) > 0;

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const companyId = Number(id);
  const navigate = useNavigate();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [entryType, setEntryType] = useState<LedgerEntryType>("charge");
  const [date, setDate] = useState(todayInput());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  // Which line is open for editing, and the working copy of its fields. Held
  // here rather than in each row so only one line is ever mid-edit.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ entry_date: "", type: "charge" as LedgerEntryType, amount: "", note: "" });
  const [editingCompany, setEditingCompany] = useState(false);
  const [companyDraft, setCompanyDraft] = useState({ name: "", type: "payable" as CompanyType });

  const q = useQuery({ queryKey: ["bookkeeping-company", companyId], queryFn: () => getCompany(companyId) });
  const invalidate = () => {
    client.invalidateQueries({ queryKey: ["bookkeeping-company", companyId] });
    client.invalidateQueries({ queryKey: ["bookkeeping-companies"] });
  };
  const onErr = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : "Action failed.");

  const addEntry = useMutation({
    mutationFn: () => addLedgerEntry(companyId, {
      entry_date: date, type: entryType, amount: amount.trim(), note: note.trim() || null,
    }),
    onSuccess: () => { setAmount(""); setNote(""); setError(null); invalidate(); },
    onError: onErr,
  });
  const saveEntry = useMutation({
    mutationFn: (entryId: number) => updateLedgerEntry(companyId, entryId, {
      entry_date: draft.entry_date,
      type: draft.type,
      amount: draft.amount.trim(),
      note: draft.note.trim() || null,
    }),
    onSuccess: () => { setEditingId(null); setError(null); invalidate(); },
    onError: onErr,
  });
  const removeEntry = useMutation({
    mutationFn: (entryId: number) => deleteLedgerEntry(companyId, entryId),
    onSuccess: () => { setError(null); invalidate(); },
    onError: onErr,
  });
  const saveCompany = useMutation({
    mutationFn: () => updateCompany(companyId, {
      name: companyDraft.name.trim(), type: companyDraft.type,
    }),
    onSuccess: () => { setEditingCompany(false); setError(null); invalidate(); },
    onError: onErr,
  });
  const toggleActive = useMutation({
    mutationFn: () => updateCompany(companyId, { active: !q.data?.active }),
    onSuccess: invalidate,
    onError: onErr,
  });

  if (q.isLoading) return <div className="page"><Loading /></div>;
  if (isStalled(q)) {
    return (
      <div className="page">
        <LoadFailed what="this company" onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const c = q.data!;
  const tone = c.type === "payable" ? "tone-neg" : "tone-ok";

  function startEdit(e: LedgerEntry) {
    setEditingId(e.id);
    setDraft({ entry_date: e.entry_date, type: e.type, amount: e.amount, note: e.note ?? "" });
  }

  return (
    <div className="page">
      <div className="row no-print">
        <button className="btn neutral sm" onClick={() => navigate("/bookkeeping")}>← Bookkeeping</button>
        <button
          className="btn neutral sm"
          style={{ marginLeft: "auto" }}
          onClick={() => navigate(`/bookkeeping/${companyId}/statement`)}
        >
          🖨 Statement
        </button>
      </div>

      <div className="row" style={{ margin: "16px 0", alignItems: "flex-start" }}>
        {editingCompany ? (
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <input
              className="input"
              value={companyDraft.name}
              onChange={(e) => setCompanyDraft((d) => ({ ...d, name: e.target.value }))}
              style={{ maxWidth: 240 }}
            />
            <select
              className="input"
              value={companyDraft.type}
              onChange={(e) => setCompanyDraft((d) => ({ ...d, type: e.target.value as CompanyType }))}
              style={{ maxWidth: 170 }}
            >
              <option value="payable">We owe them</option>
              <option value="receivable">They owe us</option>
            </select>
            <button
              className="btn primary sm"
              disabled={!companyDraft.name.trim() || saveCompany.isPending}
              onClick={() => saveCompany.mutate()}
            >
              Save
            </button>
            <button className="btn neutral sm" onClick={() => setEditingCompany(false)}>Cancel</button>
          </div>
        ) : (
          <div>
            <h1 style={{ margin: 0 }}>{c.name}</h1>
            <div className="muted">
              {c.type === "payable" ? "We owe them" : "They owe us"}
              <button
                className="btn neutral sm no-print"
                style={{ marginLeft: 8 }}
                onClick={() => { setCompanyDraft({ name: c.name, type: c.type }); setEditingCompany(true); }}
              >
                Edit
              </button>
            </div>
          </div>
        )}
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div className={tone} style={{ fontSize: 26, fontWeight: 800 }}>${c.balance}</div>
        </div>
      </div>

      {error && <ErrorMsg>{error}</ErrorMsg>}

      <div className="card no-print">
        <h2>Add entry</h2>
        <div className="row" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <div className="tabs">
            <button className={`tab${entryType === "charge" ? " active" : ""}`} onClick={() => setEntryType("charge")}>
              Charge (order/invoice)
            </button>
            <button className={`tab${entryType === "payment" ? " active" : ""}`} onClick={() => setEntryType("payment")}>
              Payment
            </button>
          </div>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 160 }} />
          <input className="input" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 120 }} />
          <input className="input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <button className="btn primary" disabled={!validAmount(amount) || addEntry.isPending} onClick={() => addEntry.mutate()}>
            Add
          </button>
        </div>
      </div>

      <div className="card">
        <h2>History</h2>
        {c.entries.length === 0 ? (
          <p className="muted">No entries yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Date</th><th>Type</th><th className="num">Amount</th><th>Note</th><th className="no-print" /></tr>
            </thead>
            <tbody>
              {c.entries.map((e) => (
                editingId === e.id ? (
                  <tr key={e.id}>
                    <td>
                      <input className="input" type="date" value={draft.entry_date}
                        onChange={(ev) => setDraft((d) => ({ ...d, entry_date: ev.target.value }))} />
                    </td>
                    <td>
                      <select className="input" value={draft.type}
                        onChange={(ev) => setDraft((d) => ({ ...d, type: ev.target.value as LedgerEntryType }))}>
                        <option value="charge">Charge</option>
                        <option value="payment">Payment</option>
                      </select>
                    </td>
                    <td>
                      <input className="input num" value={draft.amount}
                        onChange={(ev) => setDraft((d) => ({ ...d, amount: ev.target.value }))} />
                    </td>
                    <td>
                      <input className="input" placeholder="Note" value={draft.note}
                        onChange={(ev) => setDraft((d) => ({ ...d, note: ev.target.value }))} />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          className="btn primary sm"
                          disabled={!validAmount(draft.amount) || !draft.entry_date || saveEntry.isPending}
                          onClick={() => saveEntry.mutate(e.id)}
                        >
                          Save
                        </button>
                        <button className="btn neutral sm" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={e.id}>
                    <td>{formatDate(new Date(`${e.entry_date}T00:00:00`))}</td>
                    <td className={e.type === "charge" ? "tone-neg" : "tone-ok"}>
                      {e.type === "charge" ? "Charge" : "Payment"}
                    </td>
                    <td className="num">${e.amount}</td>
                    <td className="muted">{e.note ?? "—"}</td>
                    <td className="no-print">
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn neutral sm" onClick={() => startEdit(e)}>Edit</button>
                        <button className="btn neutral sm" onClick={() => removeEntry.mutate(e.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        )}
      </div>

      <button className="btn neutral no-print" onClick={() => toggleActive.mutate()}>
        {c.active ? "Archive this company" : "Reactivate this company"}
      </button>
    </div>
  );
}
