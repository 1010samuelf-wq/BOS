// The new-order screen (§2A/§11) — the core POS flow.
// Customer & order info + item list live in ../../../src/order/OrderFormFields
// (shared with Order Detail's edit mode); payment section (Pay now/later,
// method pills, Card notes modal) is specific to creating an order. All order
// math lives in src/order/orderDraft.ts.

import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiRequestError } from "../../../src/api/client";
import { useOfflineMutation } from "../../../src/offline/useOfflineMutation";
import type { PaymentMethod } from "../../../src/api/types";
import { colors, radius, spacing } from "../../../src/components/theme";
import { OrderHeaderFields, OrderItemsEditor, styles as fieldStyles } from "../../../src/order/OrderFormFields";
import {
  buildPayload,
  draftTotal,
  emptyDraft,
  validateDraft,
  type Draft,
} from "../../../src/order/orderDraft";

const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "etransfer", label: "E-transfer" },
];

export default function NewOrderScreen() {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [cardModal, setCardModal] = useState(false);
  const [cardNoteInput, setCardNoteInput] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const submit = useOfflineMutation("orders.create", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      router.replace("/(main)/orders" as never);
    },
    onError: (e) => {
      setProblems([
        e instanceof ApiRequestError ? e.message : "Could not reach the server — try again.",
      ]);
      // Same draft (same idempotency key) → a retry can never double-create.
    },
  });

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const chooseMethod = (m: PaymentMethod) => {
    set({ paymentMethod: m });
    if (m === "card") {
      setCardNoteInput(draft.cardPaymentNote);
      setCardModal(true); // Card opens the payment-notes popup (§2A)
    }
  };

  const onSubmit = () => {
    const found = validateDraft(draft);
    setProblems(found);
    if (found.length === 0) submit.mutate(buildPayload(draft));
  };

  return (
    <>
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.l, gap: spacing.l }}>
        <Text style={styles.title}>New order</Text>

        <OrderHeaderFields draft={draft} set={set} />
        <OrderItemsEditor draft={draft} setDraft={setDraft} />

        {/* ---- Order notes ---- */}
        <View style={fieldStyles.card}>
          <TextInput
            style={fieldStyles.input}
            placeholder='Order note (e.g. "they come and sit") — one per line'
            multiline
            value={draft.generalNotes.join("\n")}
            onChangeText={(t) => set({ generalNotes: t.split("\n") })}
          />
        </View>

        {/* ---- Payment ---- */}
        <View style={fieldStyles.card}>
          <View style={fieldStyles.rowWrap}>
            <View style={fieldStyles.toggle}>
              {(["now", "later"] as const).map((t) => (
                <Pressable
                  key={t}
                  style={[fieldStyles.toggleOpt, draft.paymentTiming === t && fieldStyles.toggleOptActive]}
                  onPress={() => set({ paymentTiming: t, paymentMethod: null })}
                >
                  <Text style={draft.paymentTiming === t ? fieldStyles.toggleTextActive : fieldStyles.toggleText}>
                    {t === "now" ? "Pay now" : "Pay later"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {draft.paymentTiming === "now" ? (
              <View style={styles.methods}>
                {METHODS.map((m) => (
                  <Pressable
                    key={m.key}
                    style={[fieldStyles.pill, draft.paymentMethod === m.key && styles.pillActive]}
                    onPress={() => chooseMethod(m.key)}
                  >
                    <Text style={draft.paymentMethod === m.key ? styles.pillTextActive : fieldStyles.pillText}>
                      {m.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.expectRow}>
                <View style={styles.unpaidBadge}>
                  <Text style={styles.unpaidText}>Will be marked UNPAID</Text>
                </View>
                {/* How they said they'll pay. Optional and settles nothing —
                    it lets the day be planned around what's coming in, and
                    marking the order paid later defaults to it. */}
                <Text style={styles.expectLabel}>Expecting</Text>
                {METHODS.map((m) => (
                  <Pressable
                    key={m.key}
                    style={[
                      fieldStyles.pill,
                      draft.expectedPaymentMethod === m.key && styles.pillActive,
                    ]}
                    onPress={() =>
                      set({
                        expectedPaymentMethod:
                          draft.expectedPaymentMethod === m.key ? null : m.key,
                      })
                    }
                  >
                    <Text
                      style={
                        draft.expectedPaymentMethod === m.key
                          ? styles.pillTextActive
                          : fieldStyles.pillText
                      }
                    >
                      {m.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            <View style={{ marginLeft: "auto", alignItems: "flex-end" }}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>${draftTotal(draft)}</Text>
            </View>
          </View>

          {problems.map((p) => (
            <Text key={p} style={styles.problem}>
              • {p}
            </Text>
          ))}

          <Pressable
            style={[styles.submit, submit.isPending && { opacity: 0.6 }]}
            disabled={submit.isPending}
            onPress={onSubmit}
          >
            {submit.isPending ? (
              <ActivityIndicator color={colors.primaryText} />
            ) : (
              <Text style={styles.submitText}>Submit order</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>

      {/* Card payment-notes popup (§2A) */}
      <Modal transparent visible={cardModal} animationType="fade">
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Card payment notes</Text>
            <TextInput
              style={[fieldStyles.input, { minHeight: 80 }]}
              placeholder="Terminal ref, last 4 digits, approval code…"
              multiline
              value={cardNoteInput}
              onChangeText={setCardNoteInput}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setCardModal(false)}>
                <Text style={fieldStyles.toggleText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.modalSave}
                onPress={() => {
                  setDraft((d) => ({ ...d, cardPaymentNote: cardNoteInput }));
                  setCardModal(false);
                }}
              >
                <Text style={styles.submitText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  methods: { flexDirection: "row", gap: spacing.s },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillTextActive: { color: colors.primaryText, fontWeight: "700" },
  unpaidBadge: {
    backgroundColor: "#faf3e3",
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
  },
  unpaidText: { color: colors.warn, fontWeight: "700" },
  expectRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.s },
  expectLabel: { color: colors.textMuted, fontSize: 13 },
  totalLabel: { color: colors.textMuted, fontSize: 12 },
  totalValue: { fontSize: 24, fontWeight: "800", color: colors.text },
  problem: { color: colors.danger },
  submit: {
    backgroundColor: colors.primary,
    borderRadius: radius.m,
    alignItems: "center",
    paddingVertical: spacing.m,
  },
  submitText: { color: colors.primaryText, fontWeight: "700", fontSize: 16 },
  modalWrap: { flex: 1, backgroundColor: colors.overlay, alignItems: "center", justifyContent: "center" },
  modal: {
    width: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    padding: spacing.l,
    gap: spacing.m,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.m },
  modalCancel: { paddingHorizontal: spacing.l, paddingVertical: spacing.m },
  modalSave: {
    backgroundColor: colors.primary,
    borderRadius: radius.m,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
  },
});
