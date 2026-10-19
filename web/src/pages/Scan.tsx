// Scan a document — a photo or PDF of an order form or a vendor invoice.
//
// The AI only fills in a draft. An order opens in New Order to be checked and
// submitted like any other; an invoice shows here as a short form (vendor,
// date, invoice #, total) and is saved to Bookkeeping only when someone
// presses Save. Nothing is written by the reading itself.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ApiRequestError } from "../api/client";
import * as api from "../api/endpoints";
import type { ScanKind, ScanResult, ScannedTimesheet, ScannedVendorInvoice } from "../api/types";
import { LoadFailed, Loading, PageHead, isStalled } from "../components/ui";
import {
  draftFromScan, overlapsExisting, shiftHours, shiftProblem, shiftToEntry, unmatchedCount, validTotal,
  type ShiftRow,
} from "../scan/scanDraft";

const KIND_LABEL: Record<ScanKind, string> = {
  order: "Order form", vendor_invoice: "Vendor invoice", timesheet: "Timesheet",
};
const KIND_PHRASE: Record<ScanKind, string> = {
  order: "an order form", vendor_invoice: "a vendor invoice", timesheet: "a weekly timesheet",
};

export default function Scan() {
  const options = useQuery({ queryKey: ["scan-options"], queryFn: api.scanOptions });
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [hint, setHint] = useState<ScanKind | "">("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A thumbnail of a photo, so the reading can be checked against the page.
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const read = useMutation({
    mutationFn: () => api.scanDocument(file!, hint || undefined),
    onMutate: () => { setError(null); setResult(null); },
    onSuccess: setResult,
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Couldn't reach the server."),
  });

  if (options.isLoading) return <div className="page"><Loading /></div>;
  if (isStalled(options)) {
    return <div className="page"><LoadFailed what="the scanner" onRetry={() => void options.refetch()} /></div>;
  }
  const kinds = options.data?.kinds ?? [];

  return (
    <div className="page">
      <PageHead title="Scan a document" />
      {!options.data?.enabled && (
        <div className="card"><p className="error" style={{ margin: 0 }}>
          Document reading isn't switched on for this system yet (it needs the AI key on the server).
        </p></div>
      )}

      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Take a photo or choose a PDF of {kinds.map((k) => KIND_PHRASE[k]).join(", or ")}.
          The AI reads it into a draft — you check it before anything is saved.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          style={{ display: "none" }}
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setError(null); }}
        />
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn neutral" onClick={() => inputRef.current?.click()}>
            {file ? "Choose a different file" : "Take photo / choose file"}
          </button>
          {kinds.length > 1 && (
            <select className="input" value={hint} onChange={(e) => setHint(e.target.value as ScanKind | "")}
              style={{ maxWidth: 200 }} aria-label="What is it?">
              <option value="">What is it? (let the AI tell)</option>
              {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          )}
          <button className="btn primary" disabled={!file || read.isPending || !options.data?.enabled}
            onClick={() => read.mutate()}>
            {read.isPending ? "Reading… (can take 20–40 seconds)" : "Read it"}
          </button>
        </div>
        {file && (
          <div className="scan-file">
            {preview ? <img src={preview} alt="The page being read" /> : <span className="muted">📄 {file.name}</span>}
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      {result && <ScanReview result={result} onAgain={() => { setResult(null); setFile(null); }} />}
    </div>
  );
}

function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="scan-warnings">
      <strong>Check these:</strong>
      <ul>{items.map((w, i) => <li key={i}>{w}</li>)}</ul>
    </div>
  );
}

function ScanReview({ result, onAgain }: { result: ScanResult; onAgain: () => void }) {
  if (result.kind === "order" && result.order) return <OrderReview result={result} />;
  if (result.kind === "timesheet" && result.timesheet) {
    return <TimesheetReview read={result.timesheet} warnings={result.warnings} onAgain={onAgain} />;
  }
  if (result.kind === "vendor_invoice" && result.vendor_invoice) {
    return <InvoiceReview read={result.vendor_invoice} warnings={result.warnings} onAgain={onAgain} />;
  }
  return (
    <div className="card">
      <h2>Couldn't read this one</h2>
      <Warnings items={result.warnings.length ? result.warnings : ["It didn't look like a document this screen reads."]} />
      <button className="btn neutral" onClick={onAgain}>Try another photo</button>
    </div>
  );
}

function OrderReview({ result }: { result: ScanResult }) {
  const navigate = useNavigate();
  const o = result.order!;
  const unmatched = unmatchedCount(o);
  return (
    <div className="card">
      <h2>Order form</h2>
      <p style={{ margin: "0 0 6px" }}>
        <strong>{o.customer_name || "No name read"}</strong>
        {o.customer_phone && <> · {o.customer_phone}</>}
        {o.needed_for_date && <> · for {o.needed_for_date}{o.needed_for_time && ` ${o.needed_for_time}`}</>}
        {o.fulfillment && <> · {o.fulfillment}</>}
        {o.delivery_name && <> to <strong>{o.delivery_name}</strong></>}
        {o.payment_method && <> · pays by {o.payment_method}</>}
      </p>
      {o.card_message && (
        <p style={{ margin: "0 0 8px" }}>Card: <span dir="auto" className="scan-card">{o.card_message}</span></p>
      )}
      {o.notes && <p className="muted" style={{ margin: "0 0 8px" }}>Notes: {o.notes}</p>}
      <table>
        <thead><tr><th>Written on the form</th><th>Matched to</th><th className="num">Qty</th></tr></thead>
        <tbody>
          {o.items.map((it, i) => (
            <tr key={i}>
              <td>{it.written_as}</td>
              <td>{it.product_name ?? <span className="error">No match — will be a custom item</span>}</td>
              <td className="num">{it.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {unmatched > 0 && (
        <p className="muted" style={{ fontSize: 13 }}>
          {unmatched} line{unmatched === 1 ? "" : "s"} didn't match a product. They'll come through as custom
          items with the words as written — set a price or pick the right product in the order.
        </p>
      )}
      <Warnings items={result.warnings} />
      <button className="btn primary" onClick={() => navigate("/orders/new", { state: { fromScan: draftFromScan(o) } })}>
        Open as a new order
      </button>
    </div>
  );
}

function InvoiceReview({ read, warnings, onAgain }: {
  read: ScannedVendorInvoice; warnings: string[]; onAgain: () => void;
}) {
  const client = useQueryClient();
  const vendors = useQuery({ queryKey: ["bookkeeping-companies"], queryFn: () => api.listCompanies() });
  const [vendorId, setVendorId] = useState<string>(read.vendor_id ? String(read.vendor_id) : "new");
  const [newName, setNewName] = useState(read.vendor_id ? "" : read.vendor_name);
  const [date, setDate] = useState(read.date || new Date().toISOString().slice(0, 10));
  const [number, setNumber] = useState(read.invoice_number);
  const [total, setTotal] = useState(read.total);
  const [saved, setSaved] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      let id = Number(vendorId);
      let name = vendors.data?.find((v) => v.id === id)?.name ?? "";
      if (vendorId === "new") {
        const created = await api.createCompany({ name: newName.trim(), type: "payable" });
        id = created.id;
        name = created.name;
      }
      await api.addLedgerEntry(id, {
        entry_date: date, type: "charge", amount: total.trim(), invoice_number: number.trim() || null,
      });
      return { id, name };
    },
    onSuccess: (v) => {
      setSaved(v);
      client.invalidateQueries({ queryKey: ["bookkeeping-companies"] });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Couldn't save."),
  });

  if (saved) {
    return (
      <div className="card">
        <h2>Saved</h2>
        <p>
          Invoice {number || ""} for ${total} added to <Link to={`/bookkeeping/${saved.id}`}><strong>{saved.name}</strong></Link>.
          When you pay it, open the vendor and press <strong>Mark paid</strong> — that records the payment and
          puts the expense in Reports.
        </p>
        <button className="btn neutral" onClick={onAgain}>Scan another</button>
      </div>
    );
  }

  const payable = (vendors.data ?? []).filter((v) => v.type === "payable");
  const canSave = validTotal(total) && !!date && (vendorId !== "new" || newName.trim().length > 0);
  return (
    <div className="card">
      <h2>Vendor invoice</h2>
      <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>Check each field against the paper, then save.</p>
      <div className="scan-form">
        <label>
          <span>Vendor</span>
          <select className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            {payable.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            <option value="new">+ New vendor…</option>
          </select>
        </label>
        {vendorId === "new" && (
          <label>
            <span>New vendor's name</span>
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
        )}
        <label>
          <span>Invoice date</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>Invoice #</span>
          <input className="input" value={number} onChange={(e) => setNumber(e.target.value)} />
        </label>
        <label>
          <span>Total ($)</span>
          <input className="input" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
        </label>
      </div>
      <Warnings items={[...warnings, ...(read.date ? [] : ["No date could be read — it's set to today."])]} />
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
        Save to Bookkeeping
      </button>
    </div>
  );
}

function TimesheetReview({ read, warnings, onAgain }: {
  read: ScannedTimesheet; warnings: string[]; onAgain: () => void;
}) {
  const client = useQueryClient();
  // Every active employee's name, readable by managers too
  // (the full staff list is admin-only).
  const roster = useQuery({ queryKey: ["staff"], queryFn: api.fetchStaff });
  const [employeeId, setEmployeeId] = useState<string>(read.employee_id ? String(read.employee_id) : "");
  const [rows, setRows] = useState<ShiftRow[]>(() => read.shifts.map((sh) => ({ ...sh, include: true })));
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  const existing = useQuery({
    queryKey: ["time-entries", employeeId, dates[0], dates[dates.length - 1]],
    queryFn: () => api.listTimeEntries({ employee_id: Number(employeeId), from: dates[0], to: dates[dates.length - 1] }),
    enabled: !!employeeId && dates.length > 0,
  });
  const already = (r: ShiftRow) => overlapsExisting(r, existing.data ?? []);

  // A shift that's already in the system starts unticked, so scanning the same
  // sheet twice doesn't double the week.
  useEffect(() => {
    if (!existing.data) return;
    setRows((rs) => rs.map((r) => (overlapsExisting(r, existing.data!) ? { ...r, include: false } : r)));
  }, [existing.data]);

  const edit = (i: number, patch: Partial<ShiftRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toSave = rows.filter((r) => r.include && !shiftProblem(r));
  const blocked = rows.some((r) => r.include && shiftProblem(r));

  const save = useMutation({
    mutationFn: async () => {
      for (const r of toSave) {
        await api.createTimeEntry({ user_id: Number(employeeId), ...shiftToEntry(r) });
      }
      return toSave.length;
    },
    onSuccess: (n) => {
      setSaved(n);
      client.invalidateQueries({ queryKey: ["time-entries"] });
      client.invalidateQueries({ queryKey: ["hours"] });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Couldn't save the shifts."),
  });

  const who = roster.data?.find((e) => String(e.id) === employeeId)?.name ?? read.employee_name;
  if (saved !== null) {
    return (
      <div className="card">
        <h2>Saved</h2>
        <p>{saved} shift{saved === 1 ? "" : "s"} added for <strong>{who}</strong>. They show under <Link to="/time">My time</Link> → {who}.</p>
        <button className="btn neutral" onClick={onAgain}>Scan another</button>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Timesheet</h2>
      <div className="scan-form" style={{ maxWidth: 420 }}>
        <label>
          <span>Employee{!read.employee_id && read.employee_name ? ` (sheet says "${read.employee_name}")` : ""}</span>
          <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Choose…</option>
            {(roster.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
      </div>
      <table>
        <thead><tr><th></th><th>Date</th><th>In</th><th>Out</th><th className="num">Hours</th><th></th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const problem = shiftProblem(r);
            return (
              <tr key={i} style={{ opacity: r.include ? 1 : 0.5 }}>
                <td><input type="checkbox" checked={r.include} aria-label="Include this shift"
                  onChange={(e) => edit(i, { include: e.target.checked })} /></td>
                <td><input className="input" type="date" value={r.date} onChange={(e) => edit(i, { date: e.target.value })} /></td>
                <td><input className="input" type="time" value={r.time_in} onChange={(e) => edit(i, { time_in: e.target.value })} /></td>
                <td><input className="input" type="time" value={r.time_out} onChange={(e) => edit(i, { time_out: e.target.value })} /></td>
                <td className="num">{shiftHours(r)}</td>
                <td style={{ fontSize: 12 }}>
                  {problem ? <span className="error">{problem}</span>
                    : already(r) ? <span className="muted">Already entered</span>
                    : !r.time_out ? <span className="muted">No time out — saved as still clocked in</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="btn neutral sm" style={{ marginTop: 8 }}
        onClick={() => setRows((rs) => [...rs, { date: rs[rs.length - 1]?.date ?? "", time_in: "", time_out: "", include: true }])}>
        + Add a shift
      </button>
      <Warnings items={warnings} />
      {error && <p className="error">{error}</p>}
      <button className="btn primary" style={{ marginTop: 8 }}
        disabled={!employeeId || toSave.length === 0 || blocked || save.isPending}
        onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : `Save ${toSave.length} shift${toSave.length === 1 ? "" : "s"}`}
      </button>
      {blocked && <span className="error" style={{ marginLeft: 10, fontSize: 13 }}>Fix or untick the rows marked in red.</span>}
    </div>
  );
}
