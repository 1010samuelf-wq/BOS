// Employees / Admin (§2E/§2I): Admin adds an employee (name + role); the
// employee sets their own PIN on first login. Admin can reset a forgotten PIN
// (back to first-login state) or deactivate an employee. Admin-only — the API
// returns 403 for others.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ApiRequestError } from "../../src/api/client";
import {
  createEmployee,
  deactivateEmployee,
  deleteEmployee,
  listEmployees,
  resetPin,
  updateEmployee,
} from "../../src/api/endpoints";
import type { Employee, Role } from "../../src/api/types";
import { useAuth } from "../../src/auth/AuthContext";
import { RequiresConnection } from "../../src/components/Chrome";
import { Button, Card, ErrorText, Loading, ScreenHeader } from "../../src/components/ui";
import { colors, radius, spacing } from "../../src/components/theme";

const ROLES: Role[] = ["cashier", "manager", "admin"];

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
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("cashier");

  const employees = useQuery({ queryKey: ["employees"], queryFn: () => listEmployees(true) });
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

  if (user?.role !== "admin") {
    return <ErrorText>Employee management is Admin-only.</ErrorText>;
  }

  return (
    <RequiresConnection>
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.l, gap: spacing.l }}>
        <ScreenHeader title="Employees" />
        {error && <ErrorText>{error}</ErrorText>}

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
                <Text style={role === r ? styles.pillTextOn : styles.pillText}>{r}</Text>
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
                    {e.role} · {e.pin_set ? "PIN set" : "awaiting first-login PIN"}
                  </Text>
                  {e.active && (
                    <RateEditor emp={e} saving={setRate.isPending} onSave={(rate) => setRate.mutate({ id: e.id, rate })} />
                  )}
                </View>
                {e.active ? (
                  <>
                    <Button label="Reset PIN" tone="neutral" onPress={() => reset.mutate(e.id)} />
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
      </ScrollView>
    </RequiresConnection>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  section: { fontSize: 15, fontWeight: "700", color: colors.text },
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
