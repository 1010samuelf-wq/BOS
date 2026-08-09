// Employees / Admin (§2E/§2I): Admin adds an employee (name + role); the
// employee sets their own PIN on first login. Admin can reset a forgotten PIN
// (back to first-login state) or deactivate an employee. Admin-only — the API
// returns 403 for others.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ApiRequestError } from "../../src/api/client";
import {
  createEmployee,
  deactivateEmployee,
  deleteEmployee,
  getStaffHours,
  listEmployees,
  resetPin,
  updateEmployee,
} from "../../src/api/endpoints";
import type { Employee, Role, StaffHoursRow } from "../../src/api/types";
import { roleLabel } from "../../src/api/types";
import { formatDate } from "../../src/order/dates";
import { useAuth } from "../../src/auth/AuthContext";
import { RequiresConnection } from "../../src/components/Chrome";
import { Button, Card, ErrorText, Loading, ScreenHeader } from "../../src/components/ui";
import { colors, radius, spacing } from "../../src/components/theme";

const ROLES: Role[] = ["cashier", "manager", "admin"];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function weekMonday(offset: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}

function RateEditor({ emp, onSave, saving }: { emp: Employee; onSave: (v: string) => void; saving: boolean }) {
  const [v, setV] = useState(emp.hourly_rate);
  const dirty = v !== emp.hourly_rate;
  const valid = /^\d+(\.\d{1,2})?$/.test(v.trim());
  return (
    <View style={styles.rateRow}>
      <Text style={styles.meta}>Rate $</Text>
      <TextInput style={styles.rateInput} value={v} onChangeText={setV} keyboardType="decimal-pad" />
      <Text style={styles.meta}>/hr</Text>
      {dirty && (
        <Button label="Save" tone="primary" busy={saving} disabled={!valid} onPress={() => onSave(v.trim())} />
      )}
    </View>
  );
}

export default function EmployeesScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isManager = isAdmin || user?.role === "manager";
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("cashier");
  const [weekOffset, setWeekOffset] = useState(0);
  const monday = weekMonday(weekOffset);
  const rangeLabel = (() => {
    const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
    return `${formatDate(monday)} - ${formatDate(sunday)}`;
  })();

  const hours = useQuery({
    queryKey: ["staff-hours", weekOffset],
    queryFn: () => getStaffHours(ymd(monday)),
    enabled: isManager,
  });
  const employees = useQuery({ queryKey: ["employees"], queryFn: () => listEmployees(true), enabled: isAdmin });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["employees"] });
  const onErr = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : "Action failed.");

  // A setup code is a one-time secret shown only right after create/reset-pin —
  // surface it immediately or the admin has no way to onboard the employee.
  const showCode = (e: { name: string; setup_code?: string | null }) => {
    if (e.setup_code) {
      Alert.alert("Setup code", `${e.name}'s one-time setup code:\n\n${e.setup_code}\n\nGive this to them to complete their first login.`);
    }
  };

  const create = useMutation({
    mutationFn: () => createEmployee({ name: name.trim(), role }),
    onSuccess: (e) => {
      setName("");
      setRole("cashier");
      invalidate();
      showCode(e);
    },
    onError: onErr,
  });
  const reset = useMutation({ mutationFn: resetPin, onSuccess: (e) => { invalidate(); showCode(e); }, onError: onErr });
  const deactivate = useMutation({ mutationFn: deactivateEmployee, onSuccess: invalidate, onError: onErr });
  const reactivate = useMutation({
    mutationFn: (id: number) => updateEmployee(id, { active: true }),
    onSuccess: invalidate,
    onError: onErr,
  });
  const del = useMutation({ mutationFn: deleteEmployee, onSuccess: invalidate, onError: onErr });
  const confirmDelete = (e: Employee) => {
    Alert.alert(
      "Permanently delete?",
      `Delete ${e.name}? This can't be undone. (Only works if they have no orders, tasks, or time entries.)`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => del.mutate(e.id) },
      ],
    );
  };
  const setRate = useMutation({
    mutationFn: (v: { id: number; rate: string }) => updateEmployee(v.id, { hourly_rate: v.rate }),
    onSuccess: invalidate,
    onError: onErr,
  });

  if (!isManager) {
    return <ErrorText>Employee management requires Manager access.</ErrorText>;
  }

  return (
    <RequiresConnection>
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.l, gap: spacing.l }}>
        <ScreenHeader title="Employees" />
        {error && <ErrorText>{error}</ErrorText>}

        <Card>
          <View style={styles.hoursHeader}>
            <Text style={styles.section}>Hours (all staff)</Text>
            <View style={styles.weekNav}>
              <Pressable style={styles.navBtn} onPress={() => setWeekOffset((o) => o - 1)}>
                <Text style={styles.navBtnText}>← Prev</Text>
              </Pressable>
              <Text style={styles.rangeLabel}>{rangeLabel}</Text>
              <Pressable
                style={[styles.navBtn, weekOffset >= 0 && styles.navBtnDisabled]}
                disabled={weekOffset >= 0}
                onPress={() => setWeekOffset((o) => o + 1)}
              >
                <Text style={styles.navBtnText}>Next →</Text>
              </Pressable>
              {weekOffset !== 0 && (
                <Pressable style={styles.navBtn} onPress={() => setWeekOffset(0)}>
                  <Text style={styles.navBtnText}>This week</Text>
                </Pressable>
              )}
            </View>
          </View>
          {hours.isLoading ? (
            <Loading />
          ) : (
            <>
              {(hours.data?.rows ?? []).map((row: StaffHoursRow) => (
                <Pressable
                  key={row.user_id}
                  style={styles.hoursRow}
                  onPress={() => router.push({ pathname: "/(main)/time", params: { emp: String(row.user_id) } })}
                >
                  <Text style={styles.hoursName}>{row.name} ›</Text>
                  <Text style={styles.hoursValue}>{row.total_hours.toFixed(1)}</Text>
                </Pressable>
              ))}
              {hours.data && (
                <View style={[styles.hoursRow, styles.hoursTotal]}>
                  <Text style={styles.hoursNameTotal}>Total</Text>
                  <Text style={styles.hoursValueTotal}>{hours.data.grand_total_hours.toFixed(1)}</Text>
                </View>
              )}
            </>
          )}
        </Card>

        {isAdmin && (
        <>
        <Card>
          <Text style={styles.section}>Add employee</Text>
          <TextInput style={styles.input} placeholder="Name" value={name} onChangeText={setName} />
          <View style={styles.roles}>
            {ROLES.map((r) => (
              <Pressable
                key={r}
                style={[styles.pill, role === r && styles.pillOn]}
                onPress={() => setRole(r)}
              >
                <Text style={role === r ? styles.pillTextOn : styles.pillText}>{roleLabel(r)}</Text>
              </Pressable>
            ))}
          </View>
          <Button label="Add employee" busy={create.isPending} disabled={!name.trim()} onPress={() => create.mutate()} />
          <Text style={styles.hint}>They set their own PIN on first login.</Text>
        </Card>

        <Card>
          <Text style={styles.section}>Staff</Text>
          {employees.isLoading ? (
            <Loading />
          ) : (
            (employees.data ?? []).map((e: Employee) => (
              <View key={e.id} style={[styles.row, !e.active && styles.rowInactive]}>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text style={styles.name}>
                    {e.name} {!e.active ? "· inactive" : ""}
                  </Text>
                  <Text style={styles.meta}>
                    {roleLabel(e.role)} · {e.pin_set ? "PIN set" : "awaiting first-login PIN"}
                  </Text>
                  {e.active && (
                    <RateEditor emp={e} saving={setRate.isPending} onSave={(rate) => setRate.mutate({ id: e.id, rate })} />
                  )}
                </View>
                {e.active ? (
                  <>
                    {e.role !== "admin" && (
                      <Button label="Reset PIN" tone="neutral" onPress={() => reset.mutate(e.id)} />
                    )}
                    <Button label="Deactivate" tone="danger" onPress={() => deactivate.mutate(e.id)} />
                  </>
                ) : (
                  <>
                    <Button label="Reactivate" tone="primary" onPress={() => reactivate.mutate(e.id)} />
                    <Button label="Delete" tone="danger" onPress={() => confirmDelete(e)} />
                  </>
                )}
              </View>
            ))
          )}
        </Card>
        </>
        )}
      </ScrollView>
    </RequiresConnection>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  section: { fontSize: 15, fontWeight: "700", color: colors.text },
  hoursHeader: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.s, marginBottom: spacing.s },
  weekNav: { flexDirection: "row", alignItems: "center", gap: spacing.s, marginLeft: "auto" },
  navBtn: { paddingHorizontal: spacing.m, paddingVertical: spacing.xs, borderRadius: radius.m, backgroundColor: colors.bg },
  navBtnDisabled: { opacity: 0.4 },
  navBtnText: { color: colors.text, fontWeight: "600", fontSize: 13 },
  rangeLabel: { color: colors.text, fontWeight: "700" },
  hoursRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.s,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  hoursName: { color: colors.primary, fontWeight: "600" },
  hoursValue: { color: colors.text, fontVariant: ["tabular-nums"] },
  hoursTotal: { borderBottomWidth: 0, marginTop: spacing.xs },
  hoursNameTotal: { color: colors.text, fontWeight: "800" },
  hoursValueTotal: { color: colors.text, fontWeight: "800", fontVariant: ["tabular-nums"] },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    backgroundColor: colors.bg,
    color: colors.text,
  },
  roles: { flexDirection: "row", gap: spacing.s },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.xs,
  },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { color: colors.text, textTransform: "capitalize" },
  pillTextOn: { color: "#fff", fontWeight: "700", textTransform: "capitalize" },
  hint: { color: colors.textMuted, fontSize: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    paddingVertical: spacing.s,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowInactive: { opacity: 0.5 },
  name: { color: colors.text, fontWeight: "600" },
  meta: { color: colors.textMuted, fontSize: 12, textTransform: "capitalize" },
  rateRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  rateInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.s,
    paddingHorizontal: spacing.s,
    paddingVertical: 2,
    width: 64,
    color: colors.text,
    backgroundColor: colors.bg,
  },
});
