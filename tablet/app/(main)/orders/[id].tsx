// Order detail (§2A/§11): items, notes with done checkboxes, status pipeline
// moves, mark-paid (with method), fulfill (delivered/picked up), and cancel with
// the optional Reverse Stock action. Overdue orders render red.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
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
import { OrderHeaderFields, OrderItemsEditor } from "../../../src/order/OrderFormFields";
import {
  buildUpdatePayload,
  draftFromOrder,
  draftTotal,
  validateEditDraft,
  type Draft,
} from "../../../src/order/orderDraft";
import { useAuth } from "../../../src/auth/AuthContext";
import { useConnectivity } from "../../../src/offline/connectivity";
import { useOfflineMutation } from "../../../src/offline/useOfflineMutation";
import { Button, Card, ErrorText, Loading } from "../../../src/components/ui";
import { colors, radius, spacing } from "../../../src/components/theme";

const PIPELINE: Order["status"][] = ["pending", "ready"];
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
  const { user } = useAuth();
  const { isOffline } = useConnectivity();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reverseStock, setReverseStock] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editProblems, setEditProblems] = useState<string[]>([]);
  // Mirrors `editing` for the unmount-cleanup effect below, which can't see
  // the latest state from a closure captured when the component first mounted.
  const editingRef = useRef(false);
  editingRef.current = editing;

  const q = useQuery({ queryKey: ["orders", orderId], queryFn: () => api.getOrder(orderId) });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
  };
  const onErr = (e: unknown) => setActionError(e instanceof ApiRequestError ? e.message : "Action failed.");
  const setStatus = useOfflineMutation("orders.update", { onSuccess: invalidate, onError: onErr });
  const toggleNote = useOfflineMutation("orders.toggleNote", { onSuccess: invalidate, onError: onErr });
  const addNote = useOfflineMutation("orders.addNote", { onSuccess: invalidate, onError: onErr });
  const markPaid = useOfflineMutation("orders.markPaid", { onSuccess: invalidate, onError: onErr });
  const fulfill = useOfflineMutation("orders.fulfill", { onSuccess: invalidate, onError: onErr });
  const cancel = useOfflineMutation("orders.cancel", { onSuccess: invalidate, onError: onErr });
  const del = useMutation({
    mutationFn: () => api.deleteOrder(orderId),
    onSuccess: () => { invalidate(); router.back(); },
    onError: onErr,
  });

  // The lock/release-lock dance is a live coordination mutex for two
  // *currently online* editors — acquiring or releasing it minutes-to-hours
  // later via replay would be meaningless (or could wrongly block the other
  // tablet's live edit), so it's never queued. Offline, editing just skips
  // it entirely and relies on the CAS check below (expectedUpdatedAt) as the
  // real conflict guard.
  const startEdit = useMutation({
    mutationFn: (o: Order) => (isOffline ? Promise.resolve(o) : api.lockOrder(orderId).then(() => o)),
    onSuccess: (o) => { setDraft(draftFromOrder(o)); setEditProblems([]); setEditing(true); },
    onError: onErr,
  });
  const saveEdit = useOfflineMutation("orders.update", {
    onSuccess: () => {
      if (!isOffline) void api.releaseLock(orderId);
      setEditing(false);
      setDraft(null);
      invalidate();
    },
    onError: onErr,
  });
  // Carries the order version this screen last saw, so a stale offline edit
  // (the order changed elsewhere while this tablet was disconnected) comes
  // back as a conflict to review instead of silently overwriting it.
  const saveEditWithVersion = (d: Draft) =>
    saveEdit.mutate({ order_id: orderId, patch: buildUpdatePayload(d), expectedUpdatedAt: o.updated_at ?? null });
  const cancelEdit = () => {
    if (!isOffline) void api.releaseLock(orderId).catch(() => { /* best-effort */ });
    setEditing(false);
    setDraft(null);
    setEditProblems([]);
  };
  const saveEditClick = () => {
    if (!draft) return;
    const problems = validateEditDraft(draft);
    setEditProblems(problems);
    if (problems.length === 0) saveEditWithVersion(draft);
  };

  // If the screen closes or the app backgrounds mid-edit, release the lock
  // rather than leaving the order stuck read-only for everyone else.
  useEffect(() => {
    return () => {
      if (editingRef.current && !isOffline) void api.releaseLock(orderId).catch(() => { /* best-effort */ });
    };
  }, [orderId, isOffline]);

  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorText>Couldn't load order #{orderId}.</ErrorText>;

  const o: Order = q.data;
  const overdue = isOverdue(o);
  const fulfilLabel = o.fulfillment_type === "delivery" ? "Mark as delivered" : "Mark as picked up";
  const lockedByOther = o.locked_by != null && o.locked_by !== user?.id;
  const canEdit = o.status !== "cancelled" && !lockedByOther;

  return (
    <>
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.l, gap: spacing.l }}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>← Orders</Text>
        </Pressable>

        <View style={[styles.titleRow, overdue && styles.overdueBox]}>
          {!editing ? (
            <View>
              <Text style={styles.orderMeta}>
                Order #{o.id} · <Text style={{ textTransform: "capitalize" }}>{o.fulfillment_type}</Text>
              </Text>
              <Text style={[styles.title, overdue && { color: colors.danger }]}>{o.client_name}</Text>

              {o.client_phone && (
                <Pressable onPress={() => Linking.openURL(`tel:${o.client_phone}`)}>
                  <Text style={styles.infoLine}>📞 {o.client_phone}</Text>
                </Pressable>
              )}
              {o.needed_for_date && (
                <Text style={[styles.infoLine, overdue && styles.infoLineOverdue]}>
                  📅 {formatNeeded(o.needed_for_date)}{overdue ? " — OVERDUE" : ""}
                </Text>
              )}
              {lockedByOther && (
                <Text style={styles.locked}>Being edited on another device (read-only)</Text>
              )}
            </View>
          ) : (
            <Text style={styles.orderMeta}>Editing order #{o.id}</Text>
          )}
          <View style={{ marginLeft: "auto", alignItems: "flex-end" }}>
            <Text style={styles.total}>${editing && draft ? draftTotal(draft) : o.total}</Text>
            <Text style={[styles.paid, o.paid_status === "unpaid" && { color: colors.warn }]}>
              {o.paid_status.toUpperCase()}
              {o.payment_method ? ` · ${o.payment_method}` : ""}
            </Text>
          </View>
        </View>

        {actionError && <ErrorText>{actionError}</ErrorText>}

        {!editing && (
          <View style={{ flexDirection: "row", gap: spacing.s }}>
            <Button
              label="🖨  Print receipt"
              tone="neutral"
              onPress={() =>
                printReceipt(o.id).catch((e) =>
                  setActionError(e instanceof Error ? e.message : "Could not print the receipt."),
                )
              }
            />
            {canEdit && (
              <Button label="✎ Edit order" tone="neutral" busy={startEdit.isPending} onPress={() => startEdit.mutate(o)} />
            )}
          </View>
        )}

        {!editing ? (
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
        ) : draft && (
          <>
            <OrderHeaderFields draft={draft} set={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))} />
            <OrderItemsEditor
              draft={draft}
              setDraft={(update) =>
                setDraft((d) => (d ? (typeof update === "function" ? (update as (d: Draft) => Draft)(d) : update) : d))
              }
            />
            {editProblems.map((p) => (
              <Text key={p} style={styles.problem}>• {p}</Text>
            ))}
            <View style={styles.actionRow}>
              <Button label="Save changes" tone="primary" busy={saveEdit.isPending} onPress={saveEditClick} />
              <Button label="Cancel" tone="neutral" onPress={cancelEdit} />
            </View>
          </>
        )}

        {/* Notes with done checkboxes */}
        <Card>
          <Text style={styles.section}>Notes</Text>
          {o.notes.length === 0 && <Text style={styles.muted}>No notes.</Text>}
          {o.notes.map((n) => (
            <Pressable key={n.id} style={styles.note} onPress={() => toggleNote.mutate({ order_id: orderId, note_id: n.id, done: !n.done })}>
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
                addNote.mutate({ order_id: orderId, text: newNote.trim() });
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
                  onPress={() => setStatus.mutate({ order_id: orderId, patch: { status: s }, expectedUpdatedAt: o.updated_at ?? null })}
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
                <Button label={fulfilLabel} tone="primary" busy={fulfill.isPending} onPress={() => fulfill.mutate({ order_id: orderId })} />
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
          <View style={styles.cancelledRow}>
            <Text style={styles.cancelledBanner}>
              ✕ Cancelled{o.stock_reversed ? " · stock reversed" : ""}
            </Text>
            {user?.role === "admin" && (
              <Button
                label="Delete permanently"
                tone="danger"
                busy={del.isPending}
                onPress={() =>
                  Alert.alert(
                    `Permanently delete order #${o.id}?`,
                    "This can't be undone.",
                    [
                      { text: "Keep it", style: "cancel" },
                      { text: "Delete", style: "destructive", onPress: () => del.mutate() },
                    ],
                  )
                }
              />
            )}
          </View>
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
                  cancel.mutate({ order_id: orderId, reverse_stock: reverseStock });
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
                    markPaid.mutate({ order_id: orderId, payment_method: m });
                    setPayOpen(false);
                  }}
                />
              ))}
            </View>
            <Button label="Cancel" tone="neutral" onPress={() => setPayOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  back: { color: colors.textMuted, fontSize: 15 },
  titleRow: { flexDirection: "row", alignItems: "flex-start" },
  overdueBox: { borderLeftWidth: 4, borderLeftColor: colors.danger, paddingLeft: spacing.m },
  orderMeta: { color: colors.textMuted, fontSize: 13 },
  title: { fontSize: 26, fontWeight: "800", color: colors.text, marginTop: 2, marginBottom: 6 },
  infoLine: { fontSize: 17, fontWeight: "700", color: colors.text, marginTop: 4 },
  infoLineOverdue: { color: colors.danger },
  locked: { color: colors.warn, marginTop: 6, fontStyle: "italic" },
  total: { fontSize: 24, fontWeight: "800", color: colors.text },
  paid: { fontWeight: "700", color: colors.success },
  section: { fontSize: 15, fontWeight: "700", color: colors.text },
  problem: { color: colors.danger },
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
  cancelledRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cancelledBanner: { color: colors.danger, fontWeight: "700", fontSize: 16 },
  modalWrap: { flex: 1, backgroundColor: colors.overlay, alignItems: "center", justifyContent: "center" },
  modal: { width: 460, backgroundColor: colors.surface, borderRadius: radius.l, padding: spacing.l, gap: spacing.l },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  reverseRow: { flexDirection: "row", gap: spacing.m, alignItems: "flex-start" },
  reverseLabel: { flex: 1, color: colors.text },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.m },
  methods: { flexDirection: "row", gap: spacing.m, justifyContent: "center" },
});
