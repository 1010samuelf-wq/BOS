// Time (§2G): every employee sees their own week-by-week timesheet and can print
// it (for weekly invoicing). Managers/admins can also pick any employee and fix
// punches — edit the times, add a missed shift, or delete a bad entry.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ApiRequestError } from "../api/client";
import {
  createTimeEntry,
  deleteTimeEntry,
  fetchRoster,
  listTimeEntries,
  updateTimeEntry,
} from "../api/endpoints";
import type { TimeEntry } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Loading, PageHead } from "../components/ui";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Monday of the week containing `d`, shifted by `offset` weeks. */
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
/** ISO (UTC) → value for a <input type="datetime-local"> in local time. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => new Date(v).toISOString();

function printTimesheet(name: string, range: string, entries: TimeEntry[], total: number) {
  const rows = entries
    .map(
      (e) =>
        `<tr><td>${fmtDay(e.clock_in)}</td><td>${fmtTime(e.clock_in)}</td><td>${fmtTime(e.clock_out)}</td><td style="text-align:right">${hoursOf(e).toFixed(2)}</td></tr>`,
    )
    .join("");
  const w = window.open("", "_blank", "width=760,height=800");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Timesheet — ${name}</title>
    <style>
      body{font-family:system-ui,Arial,sans-serif;margin:32px;color:#222}
      h1{margin:0 0 4px;font-size:20px} .sub{color:#666;margin:0 0 16px}
      table{border-collapse:collapse;width:100%} th,td{border:1px solid #ccc;padding:8px 10px;font-size:14px}
      th{background:#f4f4f4;text-align:left} tfoot td{font-weight:700}
    </style></head><body>
    <h1>Just Cake — Weekly Timesheet</h1>
    <p class="sub"><strong>${name}</strong> &middot; ${range}</p>
    <table><thead><tr><th>Day</th><th>Clock in</th><th>Clock out</th><th style="text-align:right">Hours</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No shifts this week.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="3">Total</td><td style="text-align:right">${total.toFixed(2)} h</td></tr></tfoot></table>
    </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

export default function Time() {
  const { user } = useAuth();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const onErr = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : "Action failed.");

  const [offset, setOffset] = useState(0);
  const [empId, setEmpId] = useState<number | "">("");
  const targetId = empId === "" ? user!.id : Number(empId);

  const monday = useMemo(() => weekMonday(offset), [offset]);
  const sunday = useMemo(() => { const d = new Date(monday); d.setDate(d.getDate() + 6); return d; }, [monday]);

  const roster = useQuery({ queryKey: ["roster"], queryFn: fetchRoster, enabled: isManager });
  const entriesQ = useQuery({
    queryKey: ["time-entries", targetId, ymd(monday)],
    queryFn: () => listTimeEntries({ employee_id: targetId, from: ymd(monday), to: ymd(sunday) }),
  });
  const entries = (entriesQ.data ?? []).slice().sort((a, b) => a.clock_in.localeCompare(b.clock_in));
  const weekTotal = entries.reduce((s, e) => s + hoursOf(e), 0);

  const invalidate = () => client.invalidateQueries({ queryKey: ["time-entries"] });
  const save = useMutation({
    mutationFn: (v: { id: number; clock_in: string; clock_out: string | null }) =>
      updateTimeEntry(v.id, { clock_in: v.clock_in, clock_out: v.clock_out }),
    onSuccess: () => { setEditId(null); invalidate(); }, onError: onErr,
  });
  const del = useMutation({ mutationFn: deleteTimeEntry, onSuccess: invalidate, onError: onErr });
  const add = useMutation({
    mutationFn: (v: { clock_in: string; clock_out: string | null }) =>
      createTimeEntry({ user_id: targetId, clock_in: v.clock_in, clock_out: v.clock_out }),
    onSuccess: () => { setAdding(false); invalidate(); }, onError: onErr,
  });

  const [editId, setEditId] = useState<number | null>(null);
  const [editIn, setEditIn] = useState(""); const [editOut, setEditOut] = useState("");
  const startEdit = (e: TimeEntry) => {
    setEditId(e.id); setEditIn(toLocalInput(e.clock_in));
    setEditOut(e.clock_out ? toLocalInput(e.clock_out) : "");
  };
  const [adding, setAdding] = useState(false);
  const [addIn, setAddIn] = useState(""); const [addOut, setAddOut] = useState("");

  const whoName = isManager && empId !== ""
    ? (roster.data?.find((r) => r.id === Number(empId))?.name ?? "Employee")
    : (user?.name ?? "Me");
  const rangeLabel = `${monday.toLocaleDateString()} – ${sunday.toLocaleDateString()}`;

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
            <select className="input" style={{ maxWidth: 200, marginLeft: "auto" }}
              value={empId} onChange={(e) => setEmpId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Me ({user?.name})</option>
              {(roster.data ?? []).filter((r) => r.id !== user?.id).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
          <button className="btn primary sm" onClick={() => printTimesheet(whoName, rangeLabel, entries, weekTotal)}>🖨 Print week</button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>{whoName} · {rangeLabel}</h2>
          <strong>Total: {weekTotal.toFixed(2)} h</strong>
        </div>
        {entriesQ.isLoading ? <Loading /> : (
          <table>
            <thead><tr><th>Day</th><th>Clock in</th><th>Clock out</th><th className="num">Hours</th>{isManager && <th></th>}</tr></thead>
            <tbody>
              {entries.map((e) => editId === e.id ? (
                <tr key={e.id}>
                  <td>{fmtDay(e.clock_in)}</td>
                  <td><input className="input" type="datetime-local" value={editIn} onChange={(ev) => setEditIn(ev.target.value)} /></td>
                  <td><input className="input" type="datetime-local" value={editOut} onChange={(ev) => setEditOut(ev.target.value)} /></td>
                  <td colSpan={2}>
                    <div className="row">
                      <button className="btn primary sm" disabled={!editIn || save.isPending}
                        onClick={() => save.mutate({ id: e.id, clock_in: fromLocalInput(editIn), clock_out: editOut ? fromLocalInput(editOut) : null })}>Save</button>
                      <button className="btn neutral sm" onClick={() => setEditId(null)}>Cancel</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={e.id}>
                  <td>{fmtDay(e.clock_in)}</td>
                  <td>{fmtTime(e.clock_in)}</td>
                  <td className={e.clock_out ? "" : "tone-low"}>{fmtTime(e.clock_out)}</td>
                  <td className="num">{hoursOf(e).toFixed(2)}</td>
                  {isManager && (
                    <td>
                      <div className="row">
                        <button className="btn neutral sm" onClick={() => startEdit(e)}>Edit</button>
                        <button className="btn danger sm" onClick={() => { if (confirm("Delete this time entry?")) del.mutate(e.id); }}>Delete</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {entries.length === 0 && <tr><td colSpan={isManager ? 5 : 4} className="muted">No shifts this week.</td></tr>}
            </tbody>
          </table>
        )}

        {isManager && (adding ? (
          <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
            <span className="muted">Add shift:</span>
            <input className="input" type="datetime-local" value={addIn} onChange={(e) => setAddIn(e.target.value)} title="Clock in" />
            <input className="input" type="datetime-local" value={addOut} onChange={(e) => setAddOut(e.target.value)} title="Clock out (optional)" />
            <button className="btn primary sm" disabled={!addIn || add.isPending}
              onClick={() => add.mutate({ clock_in: fromLocalInput(addIn), clock_out: addOut ? fromLocalInput(addOut) : null })}>Add</button>
            <button className="btn neutral sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        ) : (
          <button className="btn neutral sm" style={{ marginTop: 12 }} onClick={() => { setAdding(true); setAddIn(""); setAddOut(""); }}>＋ Add missed shift</button>
        ))}
      </div>
    </div>
  );
}
