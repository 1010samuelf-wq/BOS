// Bookkeeping: accounts payable/receivable per company. Mirrors
// web/src/pages/Bookkeeping.tsx. A "payable" company is a supplier we owe
// (balance shown red); a "receivable" company is a party that owes us
// (balance shown green). Balance is always computed server-side.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ApiRequestError } from "../../../src/api/client";
import { createCompany, listCompanies } from "../../../src/api/endpoints";
import type { Company, CompanyType } from "../../../src/api/types";
import { RequiresConnection } from "../../../src/components/Chrome";
import { Button, Card, Empty, ErrorText, Loading, ScreenHeader } from "../../../src/components/ui";
import { colors, radius, spacing } from "../../../src/components/theme";

function CompanyGroup({
  title, tone, companies,
}: {
  title: string;
  tone: "danger" | "success";
  companies: Company[];
}) {
  return (
    <Card>
      <Text style={styles.groupTitle}>{title}</Text>
      {companies.length === 0 ? (
        <Empty>No companies here yet.</Empty>
      ) : (
        companies.map((c) => (
          <Pressable
            key={c.id}
            style={styles.row}
            onPress={() => router.navigate(`/(main)/bookkeeping/${c.id}` as never)}
          >
            <Text style={styles.rowName}>{c.name}</Text>
            <Text style={[styles.rowBalance, { color: colors[tone] }]}>${c.balance}</Text>
          </Pressable>
        ))
      )}
    </Card>
  );
}

export default function BookkeepingScreen() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<CompanyType>("payable");

  const companies = useQuery({ queryKey: ["bookkeeping-companies"], queryFn: () => listCompanies() });
  const create = useMutation({
    mutationFn: () => createCompany({ name: name.trim(), type }),
    onSuccess: () => {
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["bookkeeping-companies"] });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Could not add company."),
  });

  const payable = (companies.data ?? []).filter((c: Company) => c.type === "payable");
  const receivable = (companies.data ?? []).filter((c: Company) => c.type === "receivable");

  return (
    <RequiresConnection>
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.l, gap: spacing.l }}>
        <ScreenHeader title="Bookkeeping" />

        <Card>
          <Text style={styles.cardTitle}>Add company</Text>
          {error && <ErrorText>{error}</ErrorText>}
          <TextInput
            style={styles.input}
            placeholder="Company name"
            value={name}
            onChangeText={setName}
          />
          <View style={styles.typeRow}>
            <Pressable
              style={[styles.typeBtn, type === "payable" && styles.typeBtnOn]}
              onPress={() => setType("payable")}
            >
              <Text style={type === "payable" ? styles.typeTextOn : styles.typeText}>We owe them</Text>
            </Pressable>
            <Pressable
              style={[styles.typeBtn, type === "receivable" && styles.typeBtnOn]}
              onPress={() => setType("receivable")}
            >
              <Text style={type === "receivable" ? styles.typeTextOn : styles.typeText}>They owe us</Text>
            </Pressable>
          </View>
          <Button label="Add" disabled={!name.trim()} busy={create.isPending} onPress={() => create.mutate()} />
        </Card>

        {companies.isLoading ? (
          <Loading />
        ) : companies.isError ? (
          <ErrorText>Bookkeeping requires access to be granted by an admin.</ErrorText>
        ) : (
          <>
            <CompanyGroup title="We owe" tone="danger" companies={payable} />
            <CompanyGroup title="Owed to us" tone="success" companies={receivable} />
          </>
        )}
      </ScrollView>
    </RequiresConnection>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: spacing.s },
  groupTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: spacing.s },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    backgroundColor: colors.bg,
    color: colors.text,
    marginBottom: spacing.s,
  },
  typeRow: { flexDirection: "row", gap: spacing.s, marginBottom: spacing.m },
  typeBtn: {
    flex: 1,
    paddingVertical: spacing.s,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  typeBtnOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeText: { color: colors.text },
  typeTextOn: { color: "#fff", fontWeight: "700" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowName: { color: colors.text, fontWeight: "600", fontSize: 15 },
  rowBalance: { fontWeight: "800", fontSize: 16 },
});
