// Time (§2G): every employee sees their own week-by-week timesheet and can print
// it (for weekly invoicing). Managers/admins can pick any employee and fix punches
// (edit / add / delete). Admins also set an hourly rate (on the Employees screen)
// and select shifts to pay — the selection shows total hours and total pay.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiRequestError } from "../api/client";
import {
  createTimeEntry,
  deleteTimeEntry,
  fetchRoster,
  listEmployees,
  listTimeEntries,
  markTimePaid,
  updateTimeEntry,
} from "../api/endpoints";
import type { TimeEntry } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Loading, PageHead } from "../components/ui";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function weekMonday(offset: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}
function hoursOf(e: TimeEntry): number {
  const start = new Date(e.clock_in).getTime();
  const end = e.clock_out ? new Date(e.clock_out).getTime() : Date.now();
  return Math.max(0, (end - start) / 3_600_000);
}
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "— open —";
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => new Date(v).toISOString();

function printTimesheet(name: string, range: string, entries: TimeEntry[], total: number, rate: number | null) {
  const rows = entries
    .map((e) => `<tr><td>${fmtDay(e.clock_in)}</td><td>${fmtTime(e.clock_in)}</td><td>${fmtTime(e.clock_out)}</td><td style="text-align:right">${hoursOf(e).toFixed(2)}</td><td>${e.paid ? "paid" : ""}</td></tr>`)
    .join("");
  const payLine = rate != null ? `<p class="sub">Rate $${rate.toFixed(2)}/hr &middot; <strong>Pay: $${(total * rate).toFixed(2)}</strong></p>` : "";
  const w = window.open("", "_blank", "width=780,height=800");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Timesheet — ${name}</title>
    <style>body{font-family:system-ui,Arial,sans-serif;margin:32px;color:#222}h1{margin:0 0 4px;font-size:20px}.sub{color:#555;margin:0 0 12px}
    table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px 10px;font-size:14px}th{background:#f4f4f4;text-align:left}tfoot td{font-weight:700}</style></head><body>
    <h1>Just Cake — Weekly Timesheet</h1><p class="sub"><strong>${name}</strong> &middot; ${range}</p>${payLine}
    <table><thead><tr><th>Day</th><th>Clock in</th><th>Clock out</th><th style="text-align:right">Hours</th><th>Paid</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">No shifts this week.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="3">Total</td><td style="text-align:right">${total.toFixed(2)} h</td><td></td></tr></tfoot></table>
    </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

export default function Time() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isManager = isAdmin || user?.role === "manager";
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const onErr = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : "Action failed.");

  const [params] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const [empId, setEmpId] = useState<number | "">(() => {
    const p = params.get("emp");
    return p ? Number(p) : "";
  });
  const targetId = empId === "" ? user!.id : Number(empId);

  const monday = useMemo(() => weekMonday(offset), [offset]);
  const sunday = useMemo(() => { const d = new Date(monday); d.setDate(d.getDate() + 6); return d; }, [monday]);

  // People to choose from + their pay rates (admins get rates; managers use the roster).
  const employeesQ = useQuery({ queryKey: ["employees"], queryFn: () => listEmployees(true), enabled: isAdmin });
  const rosterQ = useQuery({ queryKey: ["roster"], queryFn: fetchRoster, enabled: isManager && !isAdmin });
  const people = isAdmin
    ? (employeesQ.data ?? []).map((e) => ({ id: e.id, name: e.name, rate: Number(e.hourly_rate) }))
    : (rosterQ.data ?? []).map((r) => ({ id: r.id, name: r.name, rate: null as number | null }));
  const targetRate = people.find((p) => p.id === targetId)?.rate ?? null;

  const entriesQ = useQuery({
    queryKey: ["time-entries", targetId, ymd(monday)],
    queryFn: () => listTimeEntries({ employee_id: targetId, from: ymd(monday), to: ymd(sunday) }),
  });
  const entries = (entriesQ.data ?? []).slice().sort((a, b) => a.clock_in.localeCompare(b.clock_in));
  const weekTotal = entries.reduce((s, e) => s + hoursOf(e), 0);

  const invalidate = () => client.invalidateQueries({ queryKey: ["time-entries"] });
  const save = useMutation({
    mutationFn: (v: { id: number; clock_in: string; clock_out: string | null }) => updateTimeEntry(v.id, { clock_in: v.clock_in, clock_out: v.clock_out }),
    onSuccess: () => { setEditId(null); invalidate(); }, onError: onErr,
  });
  const del = useMutation({ mutationFn: deleteTimeEntry, onSuccess: invalidate, onError: onErr });
  const add = useMutation({
    mutationFn: (v: { clock_in: string; clock_out: string | null }) => createTimeEntry({ user_id: targetId, clock_in: v.clock_in, clock_out: v.clock_out }),
    onSuccess: () => { setAdding(false); invalidate(); }, onError: onErr,
  });
  const pay = useMutation({
    mutationFn: (v: { ids: number[]; paid: boolean }) => markTimePaid(v.ids, v.paid),
    onSuccess: () => { setSelected(new Set()); invalidate(); }, onError: onErr,
  });

  const [editId, setEditId] = useState<number | null>(null);
  const [editIn, setEditIn] = useState(""); const [editOut, setEditOut] = useState("");
  const startEdit = (e: TimeEntry) => { setEditId(e.id); setEditIn(toLocalInput(e.clock_in)); setEditOut(e.clock_out ? toLocalInput(e.clock_out) : ""); };
  const [adding, setAdding] = useState(false);
  const [addIn, setAddIn] = useState(""); const [addOut, setAddOut] = useState("");

  // Payroll selection (admin): completed, unpaid shifts.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => { setSelected(new Set()); }, [targetId, offset]);
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedEntries = entries.filter((e) => selected.has(e.id));
  const selHours = selectedEntries.reduce((s, e) => s + hoursOf(e), 0);
  const selPay = targetRate != null ? selHours * targetRate : null;

  const whoName = people.find((p) => p.id === targetId)?.name ?? user?.name ?? "Me";
  const rangeLabel = `${monday.toLocaleDateString()} – ${sunday.toLocaleDateString()}`;
  const cols = 4 + (isAdmin ? 1 : 0) + 1 + (isManager ? 1 : 0); // checkbox? day in out hours paid actions?

  return (
    <div className="page">
      <PageHead title="My time" />
      {error && <p className="error">{error}</p>}

      <div className="card">
        <div className="row" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn neutral sm" onClick={() => setOffset((o) => o - 1)}>← Prev week</button>
          <strong style={{ minWidth: 210, textAlign: "center" }}>{rangeLabel}</strong>
          <button className="btn neutral sm" disabled={offset >= 0} onClick={() => setOffset((o) => o + 1)}>Next week →</button>
          {offset !== 0 && <button className="btn neutral sm" onClick={() => setOffset(0)}>This week</button>}
          {isManager && (
            <select className="input" style={{ maxWidth: 220, marginLeft: "auto" }} value={empId} onChange={(e) => setEmpId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Me ({user?.name})</option>
              {people.filter((p) => p.id !== user?.id).map((p) => (
                <option key={p.id} value={p.id}>{p.name}{isAdmin && p.rate != null ? ` — $${p.rate.toFixed(2)}/hr` : ""}</option>
              ))}
            </select>
          )}
          <button className="btn primary sm" onClick={() => printTimesheet(whoName, rangeLabel, entries, weekTotal, targetRate)}>🖨 Print week</button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>{whoName} · {rangeLabel}</h2>
          <strong>Total: {weekTotal.toFixed(2)} h{targetRate != null ? ` · $${(weekTotal * targetRate).toFixed(2)}` : ""}</strong>
        </div>
        {entriesQ.isLoading ? <Loading /> : (
          <table>
            <thead><tr>
              {isAdmin && <th></th>}
              <th>Day</th><th>Clock in</th><th>Clock out</th><th className="num">Hours</th><th>Paid</th>
              {isManager && <th></th>}
            </tr></thead>
            <tbody>
              {entries.map((e) => {
                const selectable = isAdmin && !!e.clock_out && !e.paid;
                if (editId === e.id) return (
                  <tr key={e.id}>
                    {isAdmin && <td></td>}
                    <td>{fmtDay(e.clock_in)}</td>
                    <td><input className="input" type="datetime-local" value={editIn} onChange={(ev) => setEditIn(ev.target.value)} /></td>
                    <td><input className="input" type="datetime-local" value={editOut} onChange={(ev) => setEditOut(ev.target.value)} /></td>
                    <td colSpan={2 + (isManager ? 1 : 0)}>
                      <div className="row">
                        <button className="btn primary sm" disabled={!editIn || save.isPending} onClick={() => save.mutate({ id: e.id, clock_in: fromLocalInput(editIn), clock_out: editOut ? fromLocalInput(editOut) : null })}>Save</button>
                        <button className="btn neutral sm" onClick={() => setEditId(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                );
                return (
                  <tr key={e.id}>
                    {isAdmin && <td>{selectable && <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />}</td>}
                    <td>{fmtDay(e.clock_in)}</td>
                    <td>{fmtTime(e.clock_in)}</td>
                    <td className={e.clock_out ? "" : "tone-low"}>{fmtTime(e.clock_out)}</td>
                    <td className="num">{hoursOf(e).toFixed(2)}</td>
                    <td>
                      {e.paid
                        ? <span className="pill paid">PAID{isAdmin && <button className="linklike" style={{ marginLeft: 6, fontSize: 11 }} onClick={() => pay.mutate({ ids: [e.id], paid: false })}>unpay</button>}</span>
                        : <span className="muted" style={{ fontSize: 12 }}>—</span>}
                    </td>
                    {isManager && (
                      <td><div className="row">
                        <button className="btn neutral sm" onClick={() => startEdit(e)}>Edit</button>
                        <button className="btn danger sm" onClick={() => { if (confirm("Delete this time entry?")) del.mutate(e.id); }}>Delete</button>
                      </div></td>
                    )}
                  </tr>
                );
              })}
              {entries.length === 0 && <tr><td colSpan={cols} className="muted">No shifts this week.</td></tr>}
            </tbody>
          </table>
        )}

        {isManager && (adding ? (
          <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
            <span className="muted">Add shift:</span>
            <input className="input" type="datetime-local" value={addIn} onChange={(e) => setAddIn(e.target.value)} title="Clock in" />
            <input className="input" type="datetime-local" value={addOut} onChange={(e) => setAddOut(e.target.value)} title="Clock out (optional)" />
            <button className="btn primary sm" disabled={!addIn || add.isPending} onClick={() => add.mutate({ clock_in: fromLocalInput(addIn), clock_out: addOut ? fromLocalInput(addOut) : null })}>Add</button>
            <button className="btn neutral sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        ) : (
          <button className="btn neutral sm" style={{ marginTop: 12 }} onClick={() => { setAdding(true); setAddIn(""); setAddOut(""); }}>＋ Add missed shift</button>
        ))}
      </div>

      {isAdmin && (
        <div className="card" style={{ position: "sticky", bottom: 0 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <strong>{selected.size}</strong> shift{selected.size === 1 ? "" : "s"} selected · <strong>{selHours.toFixed(2)} h</strong>
              {targetRate != null
                ? <> · pay <strong>${(selPay ?? 0).toFixed(2)}</strong> <span className="muted">(@ ${targetRate.toFixed(2)}/hr)</span></>
                : <span className="muted"> · set an hourly rate on the Employees screen to see pay</span>}
            </div>
            <button className="btn primary" disabled={selected.size === 0 || pay.isPending}
              onClick={() => pay.mutate({ ids: [...selected], paid: true })}>Mark selected as paid</button>
          </div>
        </div>
      )}
    </div>
  );
}
