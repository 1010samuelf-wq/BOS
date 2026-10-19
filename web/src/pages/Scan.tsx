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
import type { ScanKind, ScanResult, ScannedVendorInvoice } from "../api/types";
import { LoadFailed, Loading, PageHead, isStalled } from "../components/ui";
import { draftFromScan, unmatchedCount, validTotal } from "../scan/scanDraft";

const KIND_LABEL: Record<ScanKind, string> = { order: "Order form", vendor_invoice: "Vendor invoice" };

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
          Take a photo or choose a PDF of {kinds.map((k) => (k === "order" ? "an order form" : "a vendor invoice")).join(" or ")}.
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
  if (result.kind === "vendor_invoice" && result.vendor_invoice) {
    return <InvoiceReview read={result.vendor_invoice} warnings={result.warnings} onAgain={onAgain} />;
  }
  return (
    <div className="card">
      <h2>Couldn't read this one</h2>
      <Warnings items={result.warnings.length ? result.warnings : ["It didn't look like an order form or a vendor invoice."]} />
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
