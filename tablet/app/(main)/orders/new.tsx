// The new-order screen (§2A/§11) — the core POS flow.
// Customer & order info on top; item list with search-as-you-type + quantity
// controls in the middle; payment section (Pay now/later, method pills, Card
// notes modal) at the bottom. All order math lives in src/order/orderDraft.ts.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { createOrder, searchProducts } from "../../../src/api/endpoints";
import type { PaymentMethod, Product } from "../../../src/api/types";
import { RequiresConnection } from "../../../src/components/Chrome";
import { QtyControl } from "../../../src/components/QtyControl";
import { colors, radius, spacing } from "../../../src/components/theme";
import {
  addProduct,
  buildPayload,
  draftTotal,
  emptyDraft,
  lineTotal,
  removeLine,
  setLineNote,
  setQuantity,
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
  const [search, setSearch] = useState("");
  const [cardModal, setCardModal] = useState(false);
  const [cardNoteInput, setCardNoteInput] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const queryClient = useQueryClient();

  // Search-as-you-type (§2A): live fuzzy dropdown from /products/search.
  const results = useQuery({
    queryKey: ["product-search", search],
    queryFn: () => searchProducts(search),
    enabled: search.trim().length >= 2,
    staleTime: 30_000,
  });

  const submit = useMutation({
    mutationFn: createOrder,
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

  const pickProduct = (p: Product) => {
    setDraft((d) => addProduct(d, p));
    setSearch("");
  };

  const chooseMethod = (m: PaymentMethod) => {
    setDraft((d) => ({ ...d, paymentMethod: m }));
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

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <RequiresConnection>
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.l, gap: spacing.l }}>
        <Text style={styles.title}>New order</Text>

        {/* ---- Customer & order info ---- */}
        <View style={styles.card}>
          <View style={styles.rowWrap}>
            <TextInput
              style={[styles.input, { flex: 2 }]}
              placeholder="Client name *"
              value={draft.clientName}
              onChangeText={(t) => set({ clientName: t })}
            />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Phone"
              keyboardType="phone-pad"
              value={draft.clientPhone}
              onChangeText={(t) => set({ clientPhone: t })}
            />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Needed for (YYYY-MM-DD HH:MM)"
              value={draft.neededFor ?? ""}
              onChangeText={(t) => set({ neededFor: t.trim() ? t.replace(" ", "T") : null })}
            />
          </View>

          <View style={styles.rowWrap}>
            <View style={styles.toggle}>
              {(["pickup", "delivery"] as const).map((f) => (
                <Pressable
                  key={f}
                  style={[styles.toggleOpt, draft.fulfillment === f && styles.toggleOptActive]}
                  onPress={() => set({ fulfillment: f })}
                >
                  <Text style={draft.fulfillment === f ? styles.toggleTextActive : styles.toggleText}>
                    {f === "pickup" ? "Pickup" : "Delivery"}
                  </Text>
                </Pressable>
              ))}
            </View>
            {draft.fulfillment === "delivery" && (
              <>
                <TextInput
                  style={[styles.input, { width: 130 }]}
                  placeholder="Delivery $"
                  keyboardType="decimal-pad"
                  value={draft.deliveryPrice}
                  onChangeText={(t) => set({ deliveryPrice: t })}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Delivery address *"
                  value={draft.deliveryAddress}
                  onChangeText={(t) => set({ deliveryAddress: t })}
                />
              </>
            )}
          </View>

          <TextInput
            style={styles.input}
            placeholder="Card message (written on the cake/card)"
            value={draft.cardMessage}
            onChangeText={(t) => set({ cardMessage: t })}
          />
        </View>

        {/* ---- Items ---- */}
        <View style={styles.card}>
          <View style={{ position: "relative", zIndex: 10 }}>
            <TextInput
              style={styles.input}
              placeholder='Search products… (e.g. "cro")'
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
            />
            {search.trim().length >= 2 && (
              <View style={styles.dropdown}>
                {results.isLoading && <ActivityIndicator style={{ padding: spacing.m }} />}
                {(results.data ?? []).map((p: Product) => (
                  <Pressable key={p.id} style={styles.dropdownRow} onPress={() => pickProduct(p)}>
                    <Text style={styles.dropdownName}>{p.name}</Text>
                    <Text style={styles.dropdownPrice}>${p.price}</Text>
                  </Pressable>
                ))}
                {results.isSuccess && results.data.length === 0 && (
                  <Text style={styles.dropdownEmpty}>No matches</Text>
                )}
              </View>
            )}
          </View>

          {draft.lines.length === 0 ? (
            <Text style={styles.emptyItems}>No items yet — search above to add.</Text>
          ) : (
            draft.lines.map((line, i) => (
              <View key={`${line.product_id}-${i}`} style={styles.line}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName}>{line.product_name}</Text>
                  <TextInput
                    style={styles.lineNote}
                    placeholder="Note for this item…"
                    value={line.note}
                    onChangeText={(t) => setDraft((d) => setLineNote(d, i, t))}
                  />
                </View>
                <QtyControl value={line.quantity} onChange={(q) => setDraft((d) => setQuantity(d, i, q))} />
                <Text style={styles.lineTotal}>${lineTotal(line)}</Text>
                <Pressable onPress={() => setDraft((d) => removeLine(d, i))}>
                  <Text style={styles.remove}>✕</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        {/* ---- Order notes ---- */}
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            placeholder='Order note (e.g. "they come and sit") — one per line'
            multiline
            value={draft.generalNotes.join("\n")}
            onChangeText={(t) => set({ generalNotes: t.split("\n") })}
          />
        </View>

        {/* ---- Payment ---- */}
        <View style={styles.card}>
          <View style={styles.rowWrap}>
            <View style={styles.toggle}>
              {(["now", "later"] as const).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.toggleOpt, draft.paymentTiming === t && styles.toggleOptActive]}
                  onPress={() => set({ paymentTiming: t, paymentMethod: null })}
                >
                  <Text style={draft.paymentTiming === t ? styles.toggleTextActive : styles.toggleText}>
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
                    style={[styles.pill, draft.paymentMethod === m.key && styles.pillActive]}
                    onPress={() => chooseMethod(m.key)}
                  >
                    <Text style={draft.paymentMethod === m.key ? styles.pillTextActive : styles.pillText}>
                      {m.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.unpaidBadge}>
                <Text style={styles.unpaidText}>Will be marked UNPAID</Text>
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
              style={[styles.input, { minHeight: 80 }]}
              placeholder="Terminal ref, last 4 digits, approval code…"
              multiline
              value={cardNoteInput}
              onChangeText={setCardNoteInput}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setCardModal(false)}>
                <Text style={styles.toggleText}>Cancel</Text>
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
    </RequiresConnection>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.l,
    gap: spacing.m,
  },
  rowWrap: { flexDirection: "row", gap: spacing.m, alignItems: "center", flexWrap: "wrap" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.bg,
    minHeight: 44,
  },
  toggle: { flexDirection: "row", borderRadius: radius.m, backgroundColor: colors.bg, padding: 3 },
  toggleOpt: { paddingHorizontal: spacing.l, paddingVertical: spacing.s, borderRadius: radius.s },
  toggleOptActive: { backgroundColor: colors.primary },
  toggleText: { color: colors.textMuted, fontWeight: "600" },
  toggleTextActive: { color: colors.primaryText, fontWeight: "700" },
  dropdown: {
    position: "absolute",
    top: 48,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    elevation: 6,
  },
  dropdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dropdownName: { color: colors.text, fontSize: 15 },
  dropdownPrice: { color: colors.textMuted },
  dropdownEmpty: { padding: spacing.m, color: colors.textMuted },
  emptyItems: { color: colors.textMuted, textAlign: "center", padding: spacing.m },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.m },
  lineName: { fontWeight: "600", color: colors.text, fontSize: 15 },
  lineNote: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 2,
    fontSize: 13,
    color: colors.text,
  },
  lineTotal: { width: 70, textAlign: "right", fontWeight: "700", color: colors.text },
  remove: { color: colors.danger, fontSize: 18, padding: spacing.s },
  methods: { flexDirection: "row", gap: spacing.s },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.s,
  },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { color: colors.text },
  pillTextActive: { color: colors.primaryText, fontWeight: "700" },
  unpaidBadge: {
    backgroundColor: "#faf3e3",
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
  },
  unpaidText: { color: colors.warn, fontWeight: "700" },
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
