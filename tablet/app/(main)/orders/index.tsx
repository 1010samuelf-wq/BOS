// Order status board (§11): three columns (Pending / In progress / Ready),
// live via WS invalidation, overdue cards red, tap → detail. A Fulfilled tab
// shows completed orders. New-order button top-right.

import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { listOrders } from "../../../src/api/endpoints";
import type { Order, OrderStatus } from "../../../src/api/types";
import { RequiresConnection } from "../../../src/components/Chrome";
import { Button, Empty, ErrorText, Loading, ScreenHeader } from "../../../src/components/ui";
import { colors, radius, spacing } from "../../../src/components/theme";
import { formatNeeded, neededDeadline } from "../../../src/order/dates";

const COLUMNS: { key: OrderStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "In progress" },
  { key: "ready", label: "Ready" },
];

function isOverdue(o: Order): boolean {
  return (
    o.fulfillment_status !== "fulfilled" &&
    o.status !== "cancelled" &&
    !!o.needed_for_date &&
    neededDeadline(o.needed_for_date) < Date.now()
  );
}

function unresolvedNotes(o: Order): number {
  return o.notes.filter((n) => !n.done).length;
}

function OrderCard({ order }: { order: Order }) {
  const overdue = isOverdue(order);
  const flags = unresolvedNotes(order);
  return (
    <Pressable
      style={[styles.card, overdue && styles.cardOverdue]}
      onPress={() => router.navigate(`/(main)/orders/${order.id}` as never)}
    >
      <View style={styles.cardTop}>
        <Text style={[styles.cardClient, overdue && { color: colors.danger }]}>
          #{order.id} {order.client_name}
        </Text>
        {flags > 0 && <Text style={styles.flag}>🚩{flags}</Text>}
      </View>
      <Text style={styles.cardItems} numberOfLines={2}>
        {order.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}
      </Text>
      <View style={styles.cardBottom}>
        <Text style={styles.cardType}>{order.fulfillment_type}</Text>
        {order.paid_status === "unpaid" && <Text style={styles.unpaid}>UNPAID</Text>}
        <Text style={styles.cardTotal}>${order.total}</Text>
      </View>
    </Pressable>
  );
}

function Pills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.pillsRow}>
      {options.map((o) => (
        <Pressable
          key={o.key}
          style={[styles.filterPill, value === o.key && styles.filterPillActive]}
          onPress={() => onChange(o.key)}
        >
          <Text style={value === o.key ? styles.filterPillTextActive : styles.filterPillText}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const EMPTY_FILTERS = {
  productName: "",
  dateField: "order" as "order" | "needed",
  from: "",
  to: "",
  status: "" as "" | OrderStatus,
  paidStatus: "" as "" | "paid" | "unpaid",
  fulfillmentType: "" as "" | "pickup" | "delivery",
};

function OrdersList() {
  const [f, setF] = useState(EMPTY_FILTERS);
  const set = (patch: Partial<typeof EMPTY_FILTERS>) => setF((cur) => ({ ...cur, ...patch }));
  const active =
    f.productName || f.from || f.to || f.status || f.paidStatus || f.fulfillmentType || f.dateField !== "order";

  const q = useQuery({
    queryKey: ["orders", "list", f],
    queryFn: () =>
      listOrders({
        limit: 200,
        product_name: f.productName.trim() || undefined,
        date_field: f.dateField,
        from: f.from.trim() || undefined,
        to: f.to.trim() || undefined,
        status: f.status || undefined,
        paid_status: f.paidStatus || undefined,
        fulfillment_type: f.fulfillmentType || undefined,
      }),
  });
  const rows: Order[] = q.data?.items ?? [];

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.l, gap: spacing.m }}>
      <View style={styles.filterCard}>
        <TextInput
          style={styles.input}
          placeholder="Product name…"
          value={f.productName}
          onChangeText={(t) => set({ productName: t })}
        />
        <View style={styles.rowWrap}>
          <Pills
            options={[
              { key: "order", label: "Order date" },
              { key: "needed", label: "Needed-for date" },
            ]}
            value={f.dateField}
            onChange={(dateField) => set({ dateField })}
          />
          <TextInput
            style={[styles.input, { width: 120 }]}
            placeholder="From (YYYY-MM-DD)"
            value={f.from}
            onChangeText={(t) => set({ from: t })}
          />
          <TextInput
            style={[styles.input, { width: 120 }]}
            placeholder="To (YYYY-MM-DD)"
            value={f.to}
            onChangeText={(t) => set({ to: t })}
          />
        </View>
        <View style={styles.rowWrap}>
          <Pills
            options={[
              { key: "", label: "Any status" },
              { key: "pending", label: "Pending" },
              { key: "in_progress", label: "In progress" },
              { key: "ready", label: "Ready" },
              { key: "cancelled", label: "Cancelled" },
            ]}
            value={f.status}
            onChange={(status) => set({ status })}
          />
          <Pills
            options={[
              { key: "", label: "Any paid" },
              { key: "paid", label: "Paid" },
              { key: "unpaid", label: "Unpaid" },
            ]}
            value={f.paidStatus}
            onChange={(paidStatus) => set({ paidStatus })}
          />
          <Pills
            options={[
              { key: "", label: "Any type" },
              { key: "pickup", label: "Pickup" },
              { key: "delivery", label: "Delivery" },
            ]}
            value={f.fulfillmentType}
            onChange={(fulfillmentType) => set({ fulfillmentType })}
          />
          {!!active && (
            <Pressable style={styles.clearBtn} onPress={() => setF(EMPTY_FILTERS)}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </Pressable>
          )}
        </View>
      </View>

      {q.isLoading ? (
        <Loading />
      ) : (
        <View style={{ gap: spacing.s }}>
          {rows.map((o) => (
            <Pressable
              key={o.id}
              style={[styles.listRow, isOverdue(o) && styles.cardOverdue]}
              onPress={() => router.navigate(`/(main)/orders/${o.id}` as never)}
            >
              <Text style={[styles.listCell, { width: 50 }]}>#{o.id}</Text>
              <Text style={[styles.listCell, { flex: 1 }]}>{o.client_name}</Text>
              <Text style={[styles.listCell, { width: 130 }]}>
                {o.needed_for_date ? formatNeeded(o.needed_for_date) : "—"}
              </Text>
              <Text style={[styles.listCell, { width: 80, textTransform: "capitalize" }]}>
                {o.fulfillment_type}
              </Text>
              <Text style={[styles.listCell, { width: 90, textTransform: "capitalize" }]}>
                {o.fulfillment_status === "fulfilled" ? "fulfilled" : o.status.replace("_", " ")}
              </Text>
              <Text
                style={[
                  styles.listCell,
                  { width: 70 },
                  o.paid_status === "unpaid" && styles.unpaid,
                ]}
              >
                {o.paid_status}
              </Text>
              <Text style={[styles.listCell, { width: 70, fontWeight: "700", textAlign: "right" }]}>
                ${o.total}
              </Text>
            </Pressable>
          ))}
          {q.isSuccess && rows.length === 0 && <Empty>No matching orders.</Empty>}
        </View>
      )}
    </ScrollView>
  );
}

export default function OrdersBoard() {
  const [tab, setTab] = useState<"board" | "list" | "fulfilled">("board");

  const active = useQuery({
    queryKey: ["orders", "active"],
    queryFn: () => listOrders({ limit: 100, fulfillment_status: "pending" }),
    enabled: tab === "board",
  });
  const fulfilled = useQuery({
    queryKey: ["orders", "fulfilled"],
    queryFn: () => listOrders({ limit: 100, fulfillment_status: "fulfilled" }),
    enabled: tab === "fulfilled",
  });

  const activeOrders: Order[] = (active.data?.items ?? []).filter((o: Order) => o.status !== "cancelled");

  return (
    <RequiresConnection>
      <View style={styles.screen}>
        <ScreenHeader
          title="Orders"
          right={
            <>
              <View style={styles.tabs}>
                {(["board", "list", "fulfilled"] as const).map((t) => (
                  <Pressable
                    key={t}
                    style={[styles.tab, tab === t && styles.tabActive]}
                    onPress={() => setTab(t)}
                  >
                    <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                      {t === "board" ? "Board" : t === "list" ? "List / filter" : "Fulfilled"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Button label="＋ New order" onPress={() => router.navigate("/(main)/orders/new" as never)} />
            </>
          }
        />

        {tab === "board" ? (
          active.isLoading ? (
            <Loading />
          ) : active.isError ? (
            <ErrorText>Couldn't load orders — retrying…</ErrorText>
          ) : (
            <View style={styles.board}>
              {COLUMNS.map((col) => {
                const cards = activeOrders.filter((o) => o.status === col.key);
                return (
                  <View key={col.key} style={styles.column}>
                    <Text style={styles.columnTitle}>
                      {col.label} <Text style={styles.count}>{cards.length}</Text>
                    </Text>
                    <ScrollView contentContainerStyle={{ gap: spacing.s, paddingBottom: spacing.l }}>
                      {cards.map((o) => (
                        <OrderCard key={o.id} order={o} />
                      ))}
                      {cards.length === 0 && <Text style={styles.colEmpty}>—</Text>}
                    </ScrollView>
                  </View>
                );
              })}
            </View>
          )
        ) : tab === "list" ? (
          <OrdersList />
        ) : fulfilled.isLoading ? (
          <Loading />
        ) : (
          <ScrollView contentContainerStyle={{ padding: spacing.l, gap: spacing.s }}>
            {(fulfilled.data?.items ?? []).map((o: Order) => (
              <OrderCard key={o.id} order={o} />
            ))}
            {fulfilled.isSuccess && fulfilled.data.items.length === 0 && (
              <Empty>No fulfilled orders.</Empty>
            )}
          </ScrollView>
        )}
      </View>
    </RequiresConnection>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  tabs: { flexDirection: "row", gap: spacing.xs },
  tab: { paddingHorizontal: spacing.m, paddingVertical: spacing.s, borderRadius: radius.m },
  tabActive: { backgroundColor: colors.bg },
  tabText: { color: colors.textMuted },
  tabTextActive: { color: colors.text, fontWeight: "600" },
  board: { flex: 1, flexDirection: "row", gap: spacing.m, padding: spacing.l },
  column: { flex: 1, backgroundColor: colors.bg, borderRadius: radius.l, padding: spacing.m },
  columnTitle: { fontWeight: "700", color: colors.text, marginBottom: spacing.s, fontSize: 15 },
  count: { color: colors.textMuted },
  colEmpty: { color: colors.textMuted, textAlign: "center", marginTop: spacing.m },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.m,
    gap: spacing.xs,
  },
  cardOverdue: { borderColor: colors.danger, backgroundColor: "#fdf1ef" },
  cardTop: { flexDirection: "row", alignItems: "center" },
  cardClient: { fontWeight: "700", color: colors.text, flex: 1 },
  flag: { color: colors.warn, fontSize: 12 },
  cardItems: { color: colors.textMuted, fontSize: 13 },
  cardBottom: { flexDirection: "row", alignItems: "center", gap: spacing.s, marginTop: spacing.xs },
  cardType: { color: colors.textMuted, fontSize: 12, textTransform: "capitalize", flex: 1 },
  unpaid: { color: colors.warn, fontSize: 11, fontWeight: "700" },
  cardTotal: { fontWeight: "700", color: colors.text },

  // ---- List / filter tab ----
  filterCard: {
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
  pillsRow: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  filterPill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.xs,
  },
  filterPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterPillText: { color: colors.textMuted, fontSize: 13 },
  filterPillTextActive: { color: colors.primaryText, fontWeight: "700", fontSize: 13 },
  clearBtn: {
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.xs,
    borderRadius: radius.m,
    backgroundColor: colors.bg,
  },
  clearBtnText: { color: colors.textMuted, fontWeight: "600", fontSize: 13 },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.m,
  },
  listCell: { color: colors.text, fontSize: 13 },
});
