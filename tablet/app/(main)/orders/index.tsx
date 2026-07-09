// Order status board (§11): three columns (Pending / In progress / Ready),
// live via WS invalidation, overdue cards red, tap → detail. A Fulfilled tab
// shows completed orders. New-order button top-right.

import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { listOrders } from "../../../src/api/endpoints";
import type { Order, OrderStatus } from "../../../src/api/types";
import { RequiresConnection } from "../../../src/components/Chrome";
import { Button, Empty, ErrorText, Loading, ScreenHeader } from "../../../src/components/ui";
import { colors, radius, spacing } from "../../../src/components/theme";

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
    new Date(o.needed_for_date).getTime() < Date.now()
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

export default function OrdersBoard() {
  const [tab, setTab] = useState<"board" | "fulfilled">("board");

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
                {(["board", "fulfilled"] as const).map((t) => (
                  <Pressable
                    key={t}
                    style={[styles.tab, tab === t && styles.tabActive]}
                    onPress={() => setTab(t)}
                  >
                    <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                      {t === "board" ? "Board" : "Fulfilled"}
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
});
