// Time (§2G): live shift timer, a week-by-week timesheet everyone can see for
// themselves and print, manager edit/add/delete of punches, and (admin) an
// hourly-rate-based payroll flow — select completed unpaid shifts, see the
// total hours + pay, mark them paid.
//
// Clock-in/out is deliberately tablet-only (§1) — it's a physical shift action.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Print from "expo-print";

import { ApiRequestError } from "../../src/api/client";
import {
  clockIn,
  clockOut,
  createTimeEntry,
  deleteTimeEntry,
  fetchRoster,
  getHours,
  listEmployees,
  listTimeEntries,
  markTimePaid,
  updateTimeEntry,
} from "../../src/api/endpoints";
import type { Employee, RosterEntry, TimeEntry } from "../../src/api/types";
import { useAuth } from "../../src/auth/AuthContext";
import { RequiresConnection } from "../../src/components/Chrome";
import { DateField, TimeField } from "../../src/components/DateTimeField";
import { Button, Card, ErrorText, Loading, ScreenHeader } from "../../src/components/ui";
import { colors, radius, spacing } from "../../src/components/theme";

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

// Plain text date+time fields (no native picker dependency) for edit/add.
function toParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
function fromParts(date: string, time: string): string | null {
  if (!date.trim()) return null;
  return time.trim() ? new Date(`${date.trim()}T${time.trim()}`).toISOString() : new Date(`${date.trim()}T00:00`).toISOString();
}

function printTimesheet(name: string, range: string, entries: TimeEntry[], total: number, rate: number | null) {
  const rows = entries
    .map(
      (e) =>
        `<tr><td>${fmtDay(e.clock_in)}</td><td>${fmtTime(e.clock_in)}</td><td>${fmtTime(e.clock_out)}</td><td style="text-align:right">${hoursOf(e).toFixed(2)}</td><td>${e.paid ? "paid" : ""}</td></tr>`,
    )
    .join("");
  const payLine = rate != null ? `<p>Rate $${rate.toFixed(2)}/hr &middot; <strong>Pay: $${(total * rate).toFixed(2)}</strong></p>` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,Arial,sans-serif;margin:24px;color:#222}
    h1{margin:0 0 4px;font-size:20px} p{color:#555;margin:0 0 12px}
    table{border-collapse:collapse;width:100%} th,td{border:1px solid #ccc;padding:6px 8px;font-size:13px}
    th{background:#f4f4f4;text-align:left} tfoot td{font-weight:700}
    </style></head><body>
    <h1>Just Cake — Weekly Timesheet</h1><p><strong>${name}</strong> &middot; ${range}</p>${payLine}
    <table><thead><tr><th>Day</th><th>Clock in</th><th>Clock out</th><th style="text-align:right">Hours</th><th>Paid</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">No shifts this week.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="3">Total</td><td style="text-align:right">${total.toFixed(2)} h</td><td></td></tr></tfoot></table>
    </body></html>`;
  Print.printAsync({ html }).catch(() => {});
}

export default function TimeScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isManager = isAdmin || user?.role === "manager";
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const onErr = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : "Action failed.");

  // ---- live shift timer ----
  const hours = useQuery({ queryKey: ["hours", "me"], queryFn: () => getHours({}) });
  const openEntry = hours.data?.open_entry ?? null;
  const open = !!openEntry;
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (!openEntry) { setElapsed(""); return; }
    const start = new Date(openEntry.clock_in).getTime();
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - start) / 1000));
      setElapsed(`${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [openEntry?.clock_in]);
  const punch = useMutation({
    mutationFn: () => (open ? clockOut() : clockIn()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hours"] }),
    onError: onErr,
  });

  // ---- week + employee selection ----
  const [offset, setOffset] = useState(0);
  const [empId, setEmpId] = useState<number | null>(null);
  const targetId = empId ?? user!.id;
  const monday = weekMonday(offset);
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);

  const employeesQ = useQuery({ queryKey: ["employees"], queryFn: () => listEmployees(true), enabled: isAdmin });
  const rosterQ = useQuery({ queryKey: ["roster"], queryFn: fetchRoster, enabled: isManager && !isAdmin });
  const employeesData: Employee[] = employeesQ.data ?? [];
  const rosterData: RosterEntry[] = rosterQ.data ?? [];
  const people = isAdmin
    ? employeesData.map((e) => ({ id: e.id, name: e.name, rate: Number(e.hourly_rate) }))
    : rosterData.map((r) => ({ id: r.id, name: r.name, rate: null as number | null }));
  const targetRate = people.find((p) => p.id === targetId)?.rate ?? null;
  const whoName = people.find((p) => p.id === targetId)?.name ?? user?.name ?? "Me";
  const rangeLabel = `${monday.toLocaleDateString()} - ${sunday.toLocaleDateString()}`;

  const entriesQ = useQuery({
    queryKey: ["time-entries", targetId, ymd(monday)],
    queryFn: () => listTimeEntries({ employee_id: targetId, from: ymd(monday), to: ymd(sunday) }),
  });
  const rawEntries: TimeEntry[] = entriesQ.data ?? [];
  const entries: TimeEntry[] = rawEntries.slice().sort((a, b) => a.clock_in.localeCompare(b.clock_in));
  const weekTotal = entries.reduce((s, e) => s + hoursOf(e), 0);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["time-entries"] });
  const save = useMutation({
    mutationFn: (v: { id: number; clock_in: string; clock_out: string | null }) =>
      updateTimeEntry(v.id, { clock_in: v.clock_in, clock_out: v.clock_out }),
    onSuccess: () => { setEditId(null); invalidate(); },
    onError: onErr,
  });
  const del = useMutation({ mutationFn: deleteTimeEntry, onSuccess: invalidate, onError: onErr });
  const add = useMutation({
    mutationFn: (v: { clock_in: string; clock_out: string | null }) =>
      createTimeEntry({ user_id: targetId, clock_in: v.clock_in, clock_out: v.clock_out }),
    onSuccess: () => { setAdding(false); invalidate(); },
    onError: onErr,
  });
  const pay = useMutation({
    mutationFn: (v: { ids: number[]; paid: boolean }) => markTimePaid(v.ids, v.paid),
    onSuccess: () => { setSelected(new Set()); invalidate(); },
    onError: onErr,
  });

  // ---- inline edit / add (plain date+time text fields) ----
  const [editId, setEditId] = useState<number | null>(null);
  const [editInDate, setEditInDate] = useState(""); const [editInTime, setEditInTime] = useState("");
  const [editOutDate, setEditOutDate] = useState(""); const [editOutTime, setEditOutTime] = useState("");
  const startEdit = (e: TimeEntry) => {
    setEditId(e.id);
    const ci = toParts(e.clock_in); setEditInDate(ci.date); setEditInTime(ci.time);
    if (e.clock_out) { const co = toParts(e.clock_out); setEditOutDate(co.date); setEditOutTime(co.time); }
    else { setEditOutDate(""); setEditOutTime(""); }
  };
  const [adding, setAdding] = useState(false);
  const [addInDate, setAddInDate] = useState(""); const [addInTime, setAddInTime] = useState("");
  const [addOutDate, setAddOutDate] = useState(""); const [addOutTime, setAddOutTime] = useState("");

  // ---- payroll selection (admin) ----
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => { setSelected(new Set()); }, [targetId, offset]);
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selHours = entries.filter((e) => selected.has(e.id)).reduce((s, e) => s + hoursOf(e), 0);
  const selPay = targetRate != null ? selHours * targetRate : null;

  const confirmDelete = (id: number) => {
    Alert.alert("Delete this shift?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => del.mutate(id) },
    ]);
  };

  return (
    <RequiresConnection>
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.l, gap: spacing.l }}>
        <ScreenHeader
          title="Time"
          right={
            <View style={{ alignItems: "flex-end", gap: spacing.xs }}>
              {open && <Text style={styles.timer}>⏱ {elapsed}</Text>}
              <Button
                label={open ? "Clock out" : "Clock in"}
                tone={open ? "danger" : "success"}
                busy={punch.isPending}
                onPress={() => punch.mutate()}
              />
            </View>
          }
        />
        {error && <ErrorText>{error}</ErrorText>}

        <Card>
          <View style={styles.weekNav}>
            <Pressable style={styles.navBtn} onPress={() => setOffset((o) => o - 1)}>
              <Text style={styles.navBtnText}>← Prev week</Text>
            </Pressable>
            <Text style={styles.rangeLabel}>{rangeLabel}</Text>
            <Pressable style={[styles.navBtn, offset >= 0 && styles.navBtnDisabled]} disabled={offset >= 0} onPress={() => setOffset((o) => o + 1)}>
              <Text style={styles.navBtnText}>Next week →</Text>
            </Pressable>
            {offset !== 0 && (
              <Pressable style={styles.navBtn} onPress={() => setOffset(0)}>
                <Text style={styles.navBtnText}>This week</Text>
              </Pressable>
            )}
          </View>

          {isManager && (
            <View style={styles.assignees}>
              <Pressable style={[styles.pill, empId === null && styles.pillOn]} onPress={() => setEmpId(null)}>
                <Text style={empId === null ? styles.pillTextOn : styles.pillText}>Me ({user?.name})</Text>
              </Pressable>
              {people.filter((p) => p.id !== user?.id).map((p) => (
                <Pressable key={p.id} style={[styles.pill, empId === p.id && styles.pillOn]} onPress={() => setEmpId(p.id)}>
                  <Text style={empId === p.id ? styles.pillTextOn : styles.pillText}>
                    {p.name}{isAdmin && p.rate != null ? ` — $${p.rate.toFixed(2)}/hr` : ""}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          <Pressable
            style={styles.printBtn}
            onPress={() => printTimesheet(whoName, rangeLabel, entries, weekTotal, targetRate)}
          >
            <Text style={styles.printBtnText}>🖨 Print week</Text>
          </Pressable>
        </Card>

        <Card>
          <View style={styles.weekNav}>
            <Text style={styles.section}>{whoName} · {rangeLabel}</Text>
            <Text style={styles.total}>
              Total: {weekTotal.toFixed(2)} h{targetRate != null ? ` · $${(weekTotal * targetRate).toFixed(2)}` : ""}
            </Text>
          </View>

          {entriesQ.isLoading ? (
            <Loading />
          ) : entries.length === 0 ? (
            <Text style={styles.muted}>No shifts this week.</Text>
          ) : (
            entries.map((e) => {
              if (editId === e.id) {
                return (
                  <View key={e.id} style={styles.editRow}>
                    <Text style={styles.dayLabel}>{fmtDay(e.clock_in)}</Text>
                    <DateField style={styles.smallInput} placeholder="In date" value={editInDate} onChange={setEditInDate} />
                    <TimeField style={styles.tinyInput} placeholder="HH:MM" value={editInTime} onChange={setEditInTime} />
                    <DateField style={styles.smallInput} placeholder="Out date" value={editOutDate} onChange={setEditOutDate} />
                    <TimeField style={styles.tinyInput} placeholder="HH:MM" value={editOutTime} onChange={setEditOutTime} />
                    <Button
                      label="Save"
                      busy={save.isPending}
                      disabled={!editInDate}
                      onPress={() => {
                        const ci = fromParts(editInDate, editInTime);
                        const co = editOutDate ? fromParts(editOutDate, editOutTime) : null;
                        if (ci) save.mutate({ id: e.id, clock_in: ci, clock_out: co });
                      }}
                    />
                    <Button label="Cancel" tone="neutral" onPress={() => setEditId(null)} />
                  </View>
                );
              }
              const selectable = isAdmin && !!e.clock_out && !e.paid;
              return (
                <View key={e.id} style={styles.entryRow}>
                  {isAdmin && (
                    <Pressable
                      style={[styles.checkbox, selected.has(e.id) && styles.checkboxOn, !selectable && styles.checkboxHidden]}
                      disabled={!selectable}
                      onPress={() => toggle(e.id)}
                    >
                      {selected.has(e.id) && <Text style={styles.check}>✓</Text>}
                    </Pressable>
                  )}
                  <Text style={[styles.entryCell, { width: 100 }]}>{fmtDay(e.clock_in)}</Text>
                  <Text style={[styles.entryCell, { width: 80 }]}>{fmtTime(e.clock_in)}</Text>
                  <Text style={[styles.entryCell, { width: 80 }, !e.clock_out && styles.openText]}>{fmtTime(e.clock_out)}</Text>
                  <Text style={[styles.entryCell, { width: 60 }]}>{hoursOf(e).toFixed(2)}</Text>
                  <View style={{ width: 70 }}>
                    {e.paid ? (
                      <Pressable onPress={() => pay.mutate({ ids: [e.id], paid: false })}>
                        <Text style={styles.paidBadge}>PAID · unpay</Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.muted}>—</Text>
                    )}
                  </View>
                  {isManager && (
                    <View style={{ flexDirection: "row", gap: spacing.xs, marginLeft: "auto" }}>
                      <Button label="Edit" tone="neutral" onPress={() => startEdit(e)} />
                      <Button label="Delete" tone="danger" onPress={() => confirmDelete(e.id)} />
                    </View>
                  )}
                </View>
              );
            })
          )}

          {isManager && (adding ? (
            <View style={styles.editRow}>
              <DateField style={styles.smallInput} placeholder="In date" value={addInDate} onChange={setAddInDate} />
              <TimeField style={styles.tinyInput} placeholder="HH:MM" value={addInTime} onChange={setAddInTime} />
              <DateField style={styles.smallInput} placeholder="Out date (optional)" value={addOutDate} onChange={setAddOutDate} />
              <TimeField style={styles.tinyInput} placeholder="HH:MM" value={addOutTime} onChange={setAddOutTime} />
              <Button
                label="Add"
                busy={add.isPending}
                disabled={!addInDate}
                onPress={() => {
                  const ci = fromParts(addInDate, addInTime);
                  const co = addOutDate ? fromParts(addOutDate, addOutTime) : null;
                  if (ci) add.mutate({ clock_in: ci, clock_out: co });
                }}
              />
              <Button label="Cancel" tone="neutral" onPress={() => setAdding(false)} />
            </View>
          ) : (
            <Pressable style={styles.addShiftBtn} onPress={() => { setAdding(true); setAddInDate(""); setAddInTime(""); setAddOutDate(""); setAddOutTime(""); }}>
              <Text style={styles.addShiftText}>＋ Add missed shift</Text>
            </Pressable>
          ))}
        </Card>

        {isAdmin && (
          <Card>
            <View style={styles.weekNav}>
              <Text style={styles.section}>
                {selected.size} shift{selected.size === 1 ? "" : "s"} selected · {selHours.toFixed(2)} h
                {targetRate != null ? ` · pay $${(selPay ?? 0).toFixed(2)} (@ $${targetRate.toFixed(2)}/hr)` : " · set an hourly rate on Employees to see pay"}
              </Text>
              <Button
                label="Mark selected as paid"
                disabled={selected.size === 0}
                busy={pay.isPending}
                onPress={() => pay.mutate({ ids: [...selected], paid: true })}
              />
            </View>
          </Card>
        )}
      </ScrollView>
    </RequiresConnection>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  timer: { fontVariant: ["tabular-nums"], fontWeight: "700", color: colors.success, fontSize: 15 },
  section: { fontSize: 15, fontWeight: "700", color: colors.text },
  total: { color: colors.text, fontWeight: "700" },
  muted: { color: colors.textMuted },
  weekNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.s },
  navBtn: { paddingHorizontal: spacing.m, paddingVertical: spacing.xs, borderRadius: radius.m, backgroundColor: colors.bg },
  navBtnDisabled: { opacity: 0.4 },
  navBtnText: { color: colors.text, fontWeight: "600", fontSize: 13 },
  rangeLabel: { color: colors.text, fontWeight: "700" },
  printBtn: { alignSelf: "flex-start", backgroundColor: colors.primary, borderRadius: radius.m, paddingHorizontal: spacing.l, paddingVertical: spacing.s, marginTop: spacing.s },
  printBtnText: { color: "#fff", fontWeight: "700" },
  assignees: { flexDirection: "row", flexWrap: "wrap", gap: spacing.s, marginTop: spacing.s },
  pill: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: spacing.m, paddingVertical: spacing.xs },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { color: colors.text },
  pillTextOn: { color: "#fff", fontWeight: "700" },
  entryRow: { flexDirection: "row", alignItems: "center", gap: spacing.s, paddingVertical: spacing.s, borderBottomWidth: 1, borderBottomColor: colors.border },
  entryCell: { color: colors.text, fontSize: 13 },
  openText: { color: colors.warn },
  paidBadge: { color: colors.success, fontWeight: "700", fontSize: 12 },
  checkbox: { width: 22, height: 22, borderRadius: radius.s, borderWidth: 2, borderColor: colors.textMuted, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxHidden: { opacity: 0.15 },
  check: { color: "#fff", fontWeight: "800", fontSize: 12 },
  editRow: { flexDirection: "row", alignItems: "center", gap: spacing.s, paddingVertical: spacing.s, flexWrap: "wrap" },
  dayLabel: { color: colors.text, fontSize: 13, width: 100 },
  smallInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.s, paddingHorizontal: spacing.s, paddingVertical: 4,
    color: colors.text, backgroundColor: colors.bg, width: 110, fontSize: 12,
  },
  tinyInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.s, paddingHorizontal: spacing.s, paddingVertical: 4,
    color: colors.text, backgroundColor: colors.bg, width: 60, fontSize: 12,
  },
  addShiftBtn: { marginTop: spacing.s, alignSelf: "flex-start", paddingHorizontal: spacing.m, paddingVertical: spacing.s, borderRadius: radius.m, backgroundColor: colors.bg },
  addShiftText: { color: colors.text, fontWeight: "600" },
});
