// A printable statement for one company — the thing you hand or send to a
// supplier when settling up.
//
// Deliberately not the ledger screen with the buttons hidden. A statement is
// read by someone outside the shop, so it leads with who it is for, what the
// period covers and what is owed, and it carries a running balance down the
// page so each line can be checked off against their own records.

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { getCompany } from "../api/endpoints";
import { LoadFailed, Loading, isStalled } from "../components/ui";
import { formatDate } from "../order/dates";

/** Money as a string, kept in cents so a long ledger doesn't drift. */
function addCents(total: number, amount: string, sign: 1 | -1): number {
  return total + sign * Math.round(Number(amount) * 100);
}
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function CompanyStatement() {
  const { id } = useParams<{ id: string }>();
  const companyId = Number(id);
  const navigate = useNavigate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const q = useQuery({
    queryKey: ["bookkeeping-company", companyId],
    queryFn: () => getCompany(companyId),
  });

  const c = q.data;

  // Opening balance is everything before the window, so a filtered statement
  // still adds up to the real balance rather than starting from zero.
  const { opening, rows, closing } = useMemo(() => {
    const entries = c?.entries ?? [];
    let open = 0;
    const inRange: { id: number; date: string; type: string; amount: string; note: string | null; running: number }[] = [];
    let running = 0;

    for (const e of entries) {
      const sign = e.type === "charge" ? 1 : -1;
      const before = from && e.entry_date < from;
      const after = to && e.entry_date > to;
      if (before) {
        open = addCents(open, e.amount, sign);
        continue;
      }
      if (after) continue;
      running = running === 0 && inRange.length === 0 ? open : running;
      running = addCents(running, e.amount, sign);
      inRange.push({ id: e.id, date: e.entry_date, type: e.type, amount: e.amount, note: e.note, running });
    }
    return { opening: open, rows: inRange, closing: inRange.length ? running : open };
  }, [c, from, to]);

  if (q.isLoading) return <div className="page"><Loading /></div>;
  if (isStalled(q) || !c) {
    return (
      <div className="page">
        <LoadFailed what="this statement" onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const owed = Number(c.balance) > 0;
  const direction = c.type === "payable" ? "Balance due to them" : "Balance due to us";

  return (
    <div className="page statement">
      <div className="row no-print" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn neutral sm" onClick={() => navigate(`/bookkeeping/${companyId}`)}>
          ← Back
        </button>
        <label className="muted" style={{ fontSize: 13 }}>
          From <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 150 }} />
        </label>
        <label className="muted" style={{ fontSize: 13 }}>
          To <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: 150 }} />
        </label>
        {(from || to) && (
          <button className="btn neutral sm" onClick={() => { setFrom(""); setTo(""); }}>Clear dates</button>
        )}
        <button className="btn primary sm" style={{ marginLeft: "auto" }} onClick={() => window.print()}>
          🖨 Print
        </button>
      </div>

      <div className="statement-sheet">
        <header className="statement-head">
          <div>
            <div className="statement-shop">Just Cake</div>
            <div className="muted" style={{ fontSize: 13 }}>Statement of account</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted" style={{ fontSize: 13 }}>Issued</div>
            <div>{formatDate(new Date())}</div>
          </div>
        </header>

        <section className="statement-to">
          <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em" }}>
            Statement for
          </div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{c.name}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {from || to
              ? `Covering ${from ? formatDate(new Date(`${from}T00:00:00`)) : "the beginning"} to ${to ? formatDate(new Date(`${to}T00:00:00`)) : "today"}`
              : "All entries to date"}
          </div>
        </section>

        <table className="statement-table">
          <thead>
            <tr>
              <th>Date</th><th>Description</th>
              <th className="num">Charge</th><th className="num">Payment</th><th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {(from || to) && (
              <tr className="statement-opening">
                <td>—</td>
                <td>Balance brought forward</td>
                <td className="num" /><td className="num" />
                <td className="num">{money(opening)}</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{formatDate(new Date(`${r.date}T00:00:00`))}</td>
                <td>{r.note ?? (r.type === "charge" ? "Charge" : "Payment")}</td>
                <td className="num">{r.type === "charge" ? `$${r.amount}` : ""}</td>
                <td className="num">{r.type === "payment" ? `$${r.amount}` : ""}</td>
                <td className="num">{money(r.running)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="muted">No entries in this period.</td></tr>
            )}
          </tbody>
        </table>

        <div className="statement-total">
          <span>{direction}</span>
          <strong>{money(closing)}</strong>
        </div>
        {!owed && Number(c.balance) === 0 && (
          <p className="muted" style={{ textAlign: "right", fontSize: 13 }}>Settled in full — thank you.</p>
        )}
      </div>
    </div>
  );
}
