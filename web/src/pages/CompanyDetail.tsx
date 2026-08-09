// One company's ledger: running balance up top, dated entries below, and a
// form to log a new charge (money now owed) or payment (money settled).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiRequestError } from "../api/client";
import { addLedgerEntry, deleteLedgerEntry, getCompany, updateCompany } from "../api/endpoints";
import type { LedgerEntryType } from "../api/types";
import { ErrorMsg, Loading } from "../components/ui";
import { formatDate } from "../order/dates";

const todayInput = () => new Date().toISOString().slice(0, 10);

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
    onSuccess: () => { setAmount(""); setNote(""); invalidate(); },
    onError: onErr,
  });
  const removeEntry = useMutation({
    mutationFn: (entryId: number) => deleteLedgerEntry(companyId, entryId),
    onSuccess: invalidate,
    onError: onErr,
  });
  const toggleActive = useMutation({
    mutationFn: () => updateCompany(companyId, { active: !q.data?.active }),
    onSuccess: invalidate,
    onError: onErr,
  });

  if (q.isLoading) return <div className="page"><Loading /></div>;
  if (q.isError || !q.data) return <div className="page"><ErrorMsg>Couldn't load this company.</ErrorMsg></div>;

  const c = q.data;
  const tone = c.type === "payable" ? "tone-neg" : "tone-ok";
  const amountValid = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;

  return (
    <div className="page">
      <button className="btn neutral sm" onClick={() => navigate("/bookkeeping")}>← Bookkeeping</button>

      <div className="row" style={{ margin: "16px 0", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ margin: 0 }}>{c.name}</h1>
          <div className="muted">{c.type === "payable" ? "We owe them" : "They owe us"}</div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div className={tone} style={{ fontSize: 26, fontWeight: 800 }}>${c.balance}</div>
        </div>
      </div>

      {error && <ErrorMsg>{error}</ErrorMsg>}

      <div className="card">
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
          <button className="btn primary" disabled={!amountValid || addEntry.isPending} onClick={() => addEntry.mutate()}>
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
              <tr><th>Date</th><th>Type</th><th className="num">Amount</th><th>Note</th><th /></tr>
            </thead>
            <tbody>
              {c.entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(new Date(`${e.entry_date}T00:00:00`))}</td>
                  <td className={e.type === "charge" ? "tone-neg" : "tone-ok"}>
                    {e.type === "charge" ? "Charge" : "Payment"}
                  </td>
                  <td className="num">${e.amount}</td>
                  <td className="muted">{e.note ?? "—"}</td>
                  <td>
                    <button className="btn neutral sm" onClick={() => removeEntry.mutate(e.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <button className="btn neutral" onClick={() => toggleActive.mutate()}>
        {c.active ? "Archive this company" : "Reactivate this company"}
      </button>
    </div>
  );
}
