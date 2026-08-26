// Order status (§11): a "By date" view — all outstanding orders sorted by
// needed-for date, with Today/Tomorrow/This week/Custom presets — live via WS
// invalidation, overdue rows red, tap → detail. List/filter and Fulfilled tabs
// alongside. New-order button top-right.

import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { listOrders } from "../../../src/api/endpoints";
import type { Order, OrderStatus } from "../../../src/api/types";
import { Button, Empty, ErrorText, Loading, ScreenHeader } from "../../../src/components/ui";
import { colors, radius, spacing } from "../../../src/components/theme";
import { asDate, formatNeeded, neededDeadline } from "../../../src/order/dates";

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

// Overdue (late) beats ready (done) — a ready order past its needed time is
// still a problem worth flagging red, not green.
function rowStyle(o: Order) {
  if (isOverdue(o)) return styles.cardOverdue;
  if (o.status === "ready") return styles.rowReady;
  return undefined;
}

function statusLabel(s: OrderStatus): string {
  return s === "in_progress" ? "In progress" : s;
}

function StatusPill({ status }: { status: OrderStatus }) {
  const bg = status === "ready" ? styles.statusReadyBg : status === "in_progress" ? styles.statusProgressBg : styles.statusPendingBg;
  const text = status === "ready" ? styles.statusReadyText : status === "in_progress" ? styles.statusProgressText : styles.statusPendingText;
  return (
    <View style={[styles.statusPillBase, bg]}>
      <Text style={[styles.statusPillText, text]}>{statusLabel(status)}</Text>
    </View>
  );
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

type DatePreset = "today" | "tomorrow" | "week" | "custom";

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function presetRange(preset: Exclude<DatePreset, "custom">): { from: string; to: string } {
  const now = new Date();
  if (preset === "today") return { from: localDay(now), to: localDay(now) };
  if (preset === "tomorrow") {
    const t = addDays(now, 1);
    return { from: localDay(t), to: localDay(t) };
  }
  return { from: localDay(now), to: localDay(addDays(now, 6)) };
}

function DateOrdersView() {
  const [preset, setPreset] = useState<DatePreset>("today");
  const today = localDay(new Date());
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const range = preset === "custom" ? { from: customFrom, to: customTo } : presetRange(preset);

  const q = useQuery({
    queryKey: ["orders", "outstanding"],
    queryFn: () => listOrders({ limit: 200, fulfillment_status: "pending", exclude_cancelled: true }),
  });

  const rows: Order[] = (q.data?.items ?? [])
    .filter((o: Order) => {
      if (!o.needed_for_date) return true; // no date to bucket — always show
      const day = localDay(asDate(o.needed_for_date));
      return day >= range.from && day <= range.to;
    })
    .sort((a: Order, b: Order) => {
      if (!a.needed_for_date && !b.needed_for_date) return 0;
      if (!a.needed_for_date) return -1;
      if (!b.needed_for_date) return 1;
      return asDate(a.needed_for_date).getTime() - asDate(b.needed_for_date).getTime();
    });

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.l, gap: spacing.m }}>
      <View style={styles.filterCard}>
        <View style={styles.rowWrap}>
          <Pills
            options={[
              { key: "today", label: "Today" },
              { key: "tomorrow", label: "Tomorrow" },
              { key: "week", label: "This week" },
              { key: "custom", label: "Custom range" },
            ]}
            value={preset}
            onChange={setPreset}
          />
          {preset === "custom" && (
            <>
              <TextInput
                style={[styles.input, { width: 120 }]}
                placeholder="From (YYYY-MM-DD)"
                value={customFrom}
                onChangeText={setCustomFrom}
              />
              <TextInput
                style={[styles.input, { width: 120 }]}
                placeholder="To (YYYY-MM-DD)"
                value={customTo}
                onChangeText={setCustomTo}
              />
            </>
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
              style={[styles.listRow, rowStyle(o)]}
              onPress={() => router.navigate(`/(main)/orders/${o.id}` as never)}
            >
              <Text style={[styles.listCell, { width: 50 }]}>#{o.id}</Text>
              <Text style={[styles.listCell, { flex: 1 }]}>{o.client_name}</Text>
              <Text style={[styles.listCell, { width: 130 }]}>
                {o.needed_for_date ? formatNeeded(o.needed_for_date) : "No date set"}
              </Text>
              <Text style={[styles.listCell, { width: 80, textTransform: "capitalize" }]}>
                {o.fulfillment_type}
              </Text>
              <View style={{ width: 100 }}>
                <StatusPill status={o.status} />
              </View>
              <Text style={[styles.listCell, { width: 70 }, o.paid_status === "unpaid" && styles.unpaid]}>
                {o.paid_status}
              </Text>
              <Text style={[styles.listCell, { width: 70, fontWeight: "700", textAlign: "right" }]}>
                ${o.total}
              </Text>
            </Pressable>
          ))}
          {q.isSuccess && rows.length === 0 && <Empty>No orders in this range.</Empty>}
        </View>
      )}
    </ScrollView>
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
              style={[styles.listRow, rowStyle(o)]}
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
              <View style={{ width: 100 }}>
                {o.fulfillment_status === "fulfilled" ? (
                  <Text style={styles.listCell}>fulfilled</Text>
                ) : (
                  <StatusPill status={o.status} />
                )}
              </View>
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
  const [tab, setTab] = useState<"date" | "list" | "fulfilled">("date");

  const fulfilled = useQuery({
    queryKey: ["orders", "fulfilled"],
    queryFn: () => listOrders({ limit: 100, fulfillment_status: "fulfilled" }),
    enabled: tab === "fulfilled",
  });

  return (
      <View style={styles.screen}>
        <ScreenHeader
          title="Orders"
          right={
            <>
              <View style={styles.tabs}>
                {(["date", "list", "fulfilled"] as const).map((t) => (
                  <Pressable
                    key={t}
                    style={[styles.tab, tab === t && styles.tabActive]}
                    onPress={() => setTab(t)}
                  >
                    <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                      {t === "date" ? "By date" : t === "list" ? "List / filter" : "Fulfilled"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Button label="＋ New order" onPress={() => router.navigate("/(main)/orders/new" as never)} />
            </>
          }
        />

        {tab === "date" ? (
          <DateOrdersView />
        ) : tab === "list" ? (
          <OrdersList />
        ) : fulfilled.isLoading ? (
          <Loading />
        ) : fulfilled.isError ? (
          <ErrorText>Couldn't load orders — retrying…</ErrorText>
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
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  tabs: { flexDirection: "row", gap: spacing.xs },
  tab: { paddingHorizontal: spacing.m, paddingVertical: spacing.s, borderRadius: radius.m },
  tabActive: { backgroundColor: colors.bg },
  tabText: { color: colors.textMuted },
  tabTextActive: { color: colors.text, fontWeight: "600" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.m,
    gap: spacing.xs,
  },
  cardOverdue: { borderColor: colors.danger, backgroundColor: "#fdf1ef" },
  rowReady: { borderColor: colors.success, backgroundColor: "#eaf3e9" },
  cardTop: { flexDirection: "row", alignItems: "center" },
  cardClient: { fontWeight: "700", color: colors.text, flex: 1 },
  flag: { color: colors.warn, fontSize: 12 },
  cardItems: { color: colors.textMuted, fontSize: 13 },
  cardBottom: { flexDirection: "row", alignItems: "center", gap: spacing.s, marginTop: spacing.xs },
  cardType: { color: colors.textMuted, fontSize: 12, textTransform: "capitalize" },
  unpaid: { color: colors.warn, fontSize: 11, fontWeight: "700" },
  cardTotal: { fontWeight: "700", color: colors.text, marginLeft: "auto" },

  statusPillBase: { alignSelf: "flex-start", paddingHorizontal: spacing.s, paddingVertical: 2, borderRadius: 999 },
  statusPillText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  statusReadyBg: { backgroundColor: "#eaf3e9" },
  statusReadyText: { color: colors.success },
  statusPendingBg: { backgroundColor: "#faf3e3" },
  statusPendingText: { color: colors.warn },
  statusProgressBg: { backgroundColor: "#eef1f5" },
  statusProgressText: { color: colors.textMuted },

  // ---- filter cards / lists (shared by "By date" and "List / filter") ----
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
