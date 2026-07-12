// Order detail (§2A/§11): items, notes with done checkboxes, status pipeline
// moves, mark-paid (with method), fulfill (delivered/picked up), and cancel with
// the optional Reverse Stock action. Overdue orders render red.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiRequestError } from "../../../src/api/client";
import * as api from "../../../src/api/endpoints";
import type { Order, PaymentMethod } from "../../../src/api/types";
import { printReceipt } from "../../../src/order/receipt";
import { formatNeeded, neededDeadline } from "../../../src/order/dates";
import { RequiresConnection } from "../../../src/components/Chrome";
import { Button, Card, ErrorText, Loading } from "../../../src/components/ui";
import { colors, radius, spacing } from "../../../src/components/theme";

const PIPELINE: Order["status"][] = ["pending", "in_progress", "ready"];
const METHODS: PaymentMethod[] = ["cash", "card", "etransfer"];

function isOverdue(o: Order): boolean {
  return (
    o.fulfillment_status !== "fulfilled" &&
    o.status !== "cancelled" &&
    !!o.needed_for_date &&
    neededDeadline(o.needed_for_date) < Date.now()
  );
}

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Number(id);
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reverseStock, setReverseStock] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["orders", orderId], queryFn: () => api.getOrder(orderId) });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
  };
  const run = <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) =>
    useMutation({
      mutationFn: (args: A) => fn(...args),
      onSuccess: invalidate,
      onError: (e) =>
        setActionError(e instanceof ApiRequestError ? e.message : "Action failed."),
    });

  const setStatus = run((s: string) => api.updateOrder(orderId, { status: s }));
  const toggleNote = run((noteId: number) => api.toggleNoteDone(orderId, noteId));
  const addNote = run((text: string) => api.addNote(orderId, text));
  const markPaid = run((m?: string) => api.markPaid(orderId, m));
  const fulfill = run(() => api.fulfillOrder(orderId));
  const cancel = run((rev: boolean) => api.cancelOrder(orderId, rev));

  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorText>Couldn't load order #{orderId}.</ErrorText>;

  const o: Order = q.data;
  const overdue = isOverdue(o);
  const fulfilLabel = o.fulfillment_type === "delivery" ? "Mark as delivered" : "Mark as picked up";

  return (
    <RequiresConnection>
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.l, gap: spacing.l }}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>← Orders</Text>
        </Pressable>

        <View style={[styles.titleRow, overdue && styles.overdueBox]}>
          <View>
            <Text style={[styles.title, overdue && { color: colors.danger }]}>
              Order #{o.id} · {o.client_name}
            </Text>
            <Text style={styles.sub}>
              {o.fulfillment_type} · {o.client_phone ?? "no phone"}
              {o.needed_for_date ? ` · needed ${formatNeeded(o.needed_for_date)}` : ""}
              {overdue ? " · OVERDUE" : ""}
            </Text>
            {o.locked_by != null && (
              <Text style={styles.locked}>Being edited on another device (read-only)</Text>
            )}
          </View>
          <View style={{ marginLeft: "auto", alignItems: "flex-end" }}>
            <Text style={styles.total}>${o.total}</Text>
            <Text style={[styles.paid, o.paid_status === "unpaid" && { color: colors.warn }]}>
              {o.paid_status.toUpperCase()}
              {o.payment_method ? ` · ${o.payment_method}` : ""}
            </Text>
          </View>
        </View>

        {actionError && <ErrorText>{actionError}</ErrorText>}

        <View style={{ flexDirection: "row" }}>
          <Button
            label="🖨  Print receipt"
            tone="neutral"
            onPress={() =>
              printReceipt(o.id).catch((e) =>
                setActionError(e instanceof Error ? e.message : "Could not print the receipt."),
              )
            }
          />
        </View>

        {/* Items */}
        <Card>
          <Text style={styles.section}>Items</Text>
          {o.items.map((it) => (
            <View key={it.id} style={styles.item}>
              <Text style={styles.itemQty}>{it.quantity}×</Text>
              <Text style={styles.itemName}>{it.product_name}</Text>
              {it.note ? <Text style={styles.itemNote}>({it.note})</Text> : null}
              <Text style={styles.itemPrice}>${it.unit_price}</Text>
            </View>
          ))}
          {o.card_message ? (
            <Text style={styles.cardMsg}>🎂 “{o.card_message}”</Text>
          ) : null}
          {o.delivery_address ? (
            <Text style={styles.addr}>
              📍 {o.delivery_address}
              {o.delivery_name ? ` · for ${o.delivery_name}` : ""}
            </Text>
          ) : null}
        </Card>

        {/* Notes with done checkboxes */}
        <Card>
          <Text style={styles.section}>Notes</Text>
          {o.notes.length === 0 && <Text style={styles.muted}>No notes.</Text>}
          {o.notes.map((n) => (
            <Pressable key={n.id} style={styles.note} onPress={() => toggleNote.mutate([n.id])}>
              <View style={[styles.checkbox, n.done && styles.checkboxOn]}>
                {n.done && <Text style={styles.check}>✓</Text>}
              </View>
              <Text style={[styles.noteText, n.done && styles.noteDone]}>
                {n.text}
                {n.type === "payment" ? "  · payment" : ""}
              </Text>
            </Pressable>
          ))}
          <View style={styles.addNoteRow}>
            <TextInput
              style={styles.addNoteInput}
              placeholder="Add a note…"
              value={newNote}
              onChangeText={setNewNote}
            />
            <Button
              label="Add"
              tone="neutral"
              disabled={!newNote.trim()}
              onPress={() => {
                addNote.mutate([newNote.trim()]);
                setNewNote("");
              }}
            />
          </View>
        </Card>

        {/* Actions */}
        {o.status !== "cancelled" && o.fulfillment_status !== "fulfilled" && (
          <Card>
            <Text style={styles.section}>Progress</Text>
            <View style={styles.pipeline}>
              {PIPELINE.map((s) => (
                <Pressable
                  key={s}
                  style={[styles.stage, o.status === s && styles.stageActive]}
                  onPress={() => setStatus.mutate([s])}
                >
                  <Text style={o.status === s ? styles.stageTextActive : styles.stageText}>
                    {s.replace("_", " ")}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.actionRow}>
              {o.paid_status === "unpaid" && (
                <Button label="Mark as paid" tone="success" onPress={() => setPayOpen(true)} />
              )}
              {o.status === "ready" && (
                <Button label={fulfilLabel} tone="primary" busy={fulfill.isPending} onPress={() => fulfill.mutate([] as [])} />
              )}
              <Button label="Cancel order" tone="danger" onPress={() => setCancelOpen(true)} />
            </View>
          </Card>
        )}

        {o.fulfillment_status === "fulfilled" && (
          <Text style={styles.doneBanner}>
            ✓ {o.fulfillment_type === "delivery" ? "Delivered" : "Picked up"}
          </Text>
        )}
        {o.status === "cancelled" && (
          <Text style={styles.cancelledBanner}>
            ✕ Cancelled{o.stock_reversed ? " · stock reversed" : ""}
          </Text>
        )}
      </ScrollView>

      {/* Cancel dialog with Reverse Stock (§2A) */}
      <Modal transparent visible={cancelOpen} animationType="fade">
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Cancel order #{o.id}?</Text>
            <Pressable style={styles.reverseRow} onPress={() => setReverseStock((v) => !v)}>
              <View style={[styles.checkbox, reverseStock && styles.checkboxOn]}>
                {reverseStock && <Text style={styles.check}>✓</Text>}
              </View>
              <Text style={styles.reverseLabel}>
                Reverse stock (add deducted quantities back). Leave off if items were already made/wasted.
              </Text>
            </Pressable>
            <View style={styles.modalActions}>
              <Button label="Keep order" tone="neutral" onPress={() => setCancelOpen(false)} />
              <Button
                label="Confirm cancel"
                tone="danger"
                busy={cancel.isPending}
                onPress={() => {
                  cancel.mutate([reverseStock]);
                  setCancelOpen(false);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Mark-paid method picker (§2D — captured so breakdown is accurate) */}
      <Modal transparent visible={payOpen} animationType="fade">
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>How was it paid?</Text>
            <View style={styles.methods}>
              {METHODS.map((m) => (
                <Button
                  key={m}
                  label={m === "etransfer" ? "E-transfer" : m[0].toUpperCase() + m.slice(1)}
                  tone="neutral"
                  onPress={() => {
                    markPaid.mutate([m]);
                    setPayOpen(false);
                  }}
                />
              ))}
            </View>
            <Button label="Cancel" tone="neutral" onPress={() => setPayOpen(false)} />
          </View>
        </View>
      </Modal>
    </RequiresConnection>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  back: { color: colors.textMuted, fontSize: 15 },
  titleRow: { flexDirection: "row", alignItems: "flex-start" },
  overdueBox: { borderLeftWidth: 4, borderLeftColor: colors.danger, paddingLeft: spacing.m },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  sub: { color: colors.textMuted, marginTop: 2, textTransform: "capitalize" },
  locked: { color: colors.warn, marginTop: 4, fontStyle: "italic" },
  total: { fontSize: 24, fontWeight: "800", color: colors.text },
  paid: { fontWeight: "700", color: colors.success },
  section: { fontSize: 15, fontWeight: "700", color: colors.text },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.s },
  itemQty: { fontWeight: "700", color: colors.text, width: 36 },
  itemName: { color: colors.text, flex: 1 },
  itemNote: { color: colors.textMuted, fontStyle: "italic" },
  itemPrice: { color: colors.textMuted },
  cardMsg: { color: colors.text, marginTop: spacing.s, fontStyle: "italic" },
  addr: { color: colors.text, marginTop: 2 },
  muted: { color: colors.textMuted },
  note: { flexDirection: "row", alignItems: "center", gap: spacing.s, paddingVertical: spacing.xs },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.s,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.success, borderColor: colors.success },
  check: { color: "#fff", fontWeight: "800" },
  noteText: { color: colors.text, flex: 1 },
  noteDone: { textDecorationLine: "line-through", color: colors.textMuted },
  addNoteRow: { flexDirection: "row", gap: spacing.s, alignItems: "center", marginTop: spacing.s },
  addNoteInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    backgroundColor: colors.bg,
    color: colors.text,
  },
  pipeline: { flexDirection: "row", gap: spacing.s },
  stage: {
    flex: 1,
    paddingVertical: spacing.m,
    borderRadius: radius.m,
    backgroundColor: colors.bg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  stageActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stageText: { color: colors.textMuted, textTransform: "capitalize" },
  stageTextActive: { color: "#fff", fontWeight: "700", textTransform: "capitalize" },
  actionRow: { flexDirection: "row", gap: spacing.m, flexWrap: "wrap", marginTop: spacing.s },
  doneBanner: { color: colors.success, fontWeight: "700", fontSize: 16, textAlign: "center" },
  cancelledBanner: { color: colors.danger, fontWeight: "700", fontSize: 16, textAlign: "center" },
  modalWrap: { flex: 1, backgroundColor: colors.overlay, alignItems: "center", justifyContent: "center" },
  modal: { width: 460, backgroundColor: colors.surface, borderRadius: radius.l, padding: spacing.l, gap: spacing.l },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  reverseRow: { flexDirection: "row", gap: spacing.m, alignItems: "flex-start" },
  reverseLabel: { flex: 1, color: colors.text },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.m },
  methods: { flexDirection: "row", gap: spacing.m, justifyContent: "center" },
});
