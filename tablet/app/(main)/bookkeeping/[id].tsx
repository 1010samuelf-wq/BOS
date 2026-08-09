// One company's ledger: running balance, dated entries, and a form to log a
// new charge (money now owed) or payment (money settled). Mirrors
// web/src/pages/CompanyDetail.tsx.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ApiRequestError } from "../../../src/api/client";
import { addLedgerEntry, deleteLedgerEntry, getCompany, updateCompany } from "../../../src/api/endpoints";
import type { LedgerEntry, LedgerEntryType } from "../../../src/api/types";
import { RequiresConnection } from "../../../src/components/Chrome";
import { Button, Card, Empty, ErrorText, Loading } from "../../../src/components/ui";
import { colors, radius, spacing } from "../../../src/components/theme";
import { formatDate } from "../../../src/order/dates";

const todayInput = () => new Date().toISOString().slice(0, 10);

export default function CompanyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const companyId = Number(id);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [entryType, setEntryType] = useState<LedgerEntryType>("charge");
  const [date, setDate] = useState(todayInput());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const q = useQuery({ queryKey: ["bookkeeping-company", companyId], queryFn: () => getCompany(companyId) });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["bookkeeping-company", companyId] });
    void queryClient.invalidateQueries({ queryKey: ["bookkeeping-companies"] });
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

  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorText>Couldn't load this company.</ErrorText>;

  const c = q.data;
  const toneColor = c.type === "payable" ? colors.danger : colors.success;
  const amountValid = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;

  return (
    <RequiresConnection>
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.l, gap: spacing.l }}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>← Bookkeeping</Text>
        </Pressable>

        <View style={styles.titleRow}>
          <View>
            <Text style={styles.title}>{c.name}</Text>
            <Text style={styles.sub}>{c.type === "payable" ? "We owe them" : "They owe us"}</Text>
          </View>
          <Text style={[styles.balance, { color: toneColor }]}>${c.balance}</Text>
        </View>

        {error && <ErrorText>{error}</ErrorText>}

        <Card>
          <Text style={styles.cardTitle}>Add entry</Text>
          <View style={styles.typeRow}>
            <Pressable
              style={[styles.typeBtn, entryType === "charge" && styles.typeBtnOn]}
              onPress={() => setEntryType("charge")}
            >
              <Text style={entryType === "charge" ? styles.typeTextOn : styles.typeText}>
                Charge (order/invoice)
              </Text>
            </Pressable>
            <Pressable
              style={[styles.typeBtn, entryType === "payment" && styles.typeBtnOn]}
              onPress={() => setEntryType("payment")}
            >
              <Text style={entryType === "payment" ? styles.typeTextOn : styles.typeText}>Payment</Text>
            </Pressable>
          </View>
          <TextInput style={styles.input} placeholder="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
          <TextInput
            style={styles.input}
            placeholder="Amount"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
          />
          <TextInput style={styles.input} placeholder="Note (optional)" value={note} onChangeText={setNote} />
          <Button label="Add" disabled={!amountValid} busy={addEntry.isPending} onPress={() => addEntry.mutate()} />
        </Card>

        <Card>
          <Text style={styles.cardTitle}>History</Text>
          {c.entries.length === 0 ? (
            <Empty>No entries yet.</Empty>
          ) : (
            c.entries.map((e: LedgerEntry) => (
              <View key={e.id} style={styles.entryRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.entryDate}>{formatDate(new Date(`${e.entry_date}T00:00:00`))}</Text>
                  <Text style={[styles.entryType, { color: e.type === "charge" ? colors.danger : colors.success }]}>
                    {e.type === "charge" ? "Charge" : "Payment"}
                  </Text>
                  {e.note ? <Text style={styles.entryNote}>{e.note}</Text> : null}
                </View>
                <Text style={styles.entryAmount}>${e.amount}</Text>
                <Pressable onPress={() => removeEntry.mutate(e.id)}>
                  <Text style={styles.deleteLink}>Delete</Text>
                </Pressable>
              </View>
            ))
          )}
        </Card>

        <Button
          label={c.active ? "Archive this company" : "Reactivate this company"}
          tone="neutral"
          onPress={() => toggleActive.mutate()}
        />
      </ScrollView>
    </RequiresConnection>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  back: { color: colors.textMuted, fontSize: 15 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  sub: { color: colors.textMuted, marginTop: 2 },
  balance: { fontSize: 26, fontWeight: "800" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: spacing.s },
  typeRow: { flexDirection: "row", gap: spacing.s, marginBottom: spacing.s },
  typeBtn: {
    flex: 1,
    paddingVertical: spacing.s,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  typeBtnOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeText: { color: colors.text, fontSize: 13 },
  typeTextOn: { color: "#fff", fontWeight: "700", fontSize: 13 },
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
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    paddingVertical: spacing.s,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  entryDate: { color: colors.text, fontWeight: "600" },
  entryType: { fontWeight: "700", fontSize: 13 },
  entryNote: { color: colors.textMuted, fontSize: 12 },
  entryAmount: { color: colors.text, fontWeight: "700" },
  deleteLink: { color: colors.danger, fontSize: 13 },
});
