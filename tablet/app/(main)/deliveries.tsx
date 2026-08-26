// Deliveries manifest (§2A/§11): every delivery order for the day — time needed,
// client, phone, address, items, box count (distinct lines, not summed qty),
// total, paid/unpaid. CSV export/print live on the web dashboard (Phase 5); the
// tablet is the on-the-floor view.

import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { getDeliveries } from "../../src/api/endpoints";
import type { Deliveries, DeliveryRow } from "../../src/api/types";
import { Empty, ErrorText, Loading, ScreenHeader } from "../../src/components/ui";
import { DateField } from "../../src/components/DateTimeField";
import { colors, radius, spacing } from "../../src/components/theme";
import { formatNeeded, formatRelative } from "../../src/order/dates";
import { useOfflineSnapshot } from "../../src/offline/useOfflineSnapshot";

type Preset = "today" | "tomorrow" | "week" | "upcoming" | "custom";

function range(preset: Exclude<Preset, "custom">): { from: string; to: string } {
  const d = new Date();
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  if (preset === "today") return { from: iso(d), to: iso(d) };
  if (preset === "tomorrow") {
    const t = new Date(d);
    t.setDate(d.getDate() + 1);
    return { from: iso(t), to: iso(t) };
  }
  if (preset === "week") {
    const end = new Date(d);
    end.setDate(d.getDate() + 6);
    return { from: iso(d), to: iso(end) };
  }
  const end = new Date(d);
  end.setFullYear(d.getFullYear() + 5);
  return { from: iso(d), to: iso(end) };
}

export default function DeliveriesScreen() {
  const [preset, setPreset] = useState<Preset>("today");
  const todayStr = new Date().toISOString().slice(0, 10);
  const [customFrom, setCustomFrom] = useState(todayStr);
  const [customTo, setCustomTo] = useState(todayStr);
  const r = preset === "custom" ? { from: customFrom, to: customTo } : range(preset);
  const deliveries = useQuery({
    queryKey: ["deliveries", preset, r.from, r.to],
    queryFn: () => getDeliveries(r),
    enabled: preset !== "custom" || (!!customFrom && !!customTo && customFrom <= customTo),
  });
  const snap = useOfflineSnapshot<Deliveries>("bos.snapshot.deliveries", deliveries.data);
  const rows: DeliveryRow[] = snap.data?.rows ?? [];

  return (
      <View style={styles.screen}>
        <ScreenHeader
          title="Deliveries"
          right={
            <View style={styles.tabs}>
              {(["today", "tomorrow", "week", "upcoming", "custom"] as Preset[]).map((p) => (
                <Pressable
                  key={p}
                  style={[styles.tab, preset === p && styles.tabActive]}
                  onPress={() => setPreset(p)}
                >
                  <Text style={[styles.tabText, preset === p && styles.tabTextActive]}>
                    {p === "week" ? "This week" : p === "upcoming" ? "Upcoming (no limit)" : p[0].toUpperCase() + p.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          }
        />
        {preset === "custom" && (
          <View style={{ flexDirection: "row", gap: spacing.s, paddingHorizontal: spacing.l, paddingTop: spacing.m }}>
            <DateField value={customFrom} onChange={setCustomFrom} style={{ flex: 1 }} />
            <DateField value={customTo} onChange={setCustomTo} style={{ flex: 1 }} />
          </View>
        )}
        {snap.usingSnapshot && snap.fetchedAt && (
          <View style={styles.staleBanner}>
            <Text style={styles.staleText}>
              Offline — showing data as of {formatRelative(snap.fetchedAt)}, may not reflect this exact range.
            </Text>
          </View>
        )}
        {snap.data ? (
          <ScrollView horizontal contentContainerStyle={{ padding: spacing.l }}>
            <ScrollView contentContainerStyle={{ gap: spacing.s }}>
              <View style={[styles.row, styles.headRow]}>
                <Text style={[styles.h, styles.cTime]}>Needed</Text>
                <Text style={[styles.h, styles.cClient]}>Client</Text>
                <Text style={[styles.h, styles.cRecipient]}>Recipient</Text>
                <Text style={[styles.h, styles.cAddr]}>Address</Text>
                <Text style={[styles.h, styles.cItems]}>Items</Text>
                <Text style={[styles.h, styles.cBox]}>Boxes</Text>
                <Text style={[styles.h, styles.cTotal]}>Total</Text>
                <Text style={[styles.h, styles.cPaid]}>Paid</Text>
              </View>
              {rows.map((r) => (
                <View key={r.order_id} style={styles.row}>
                  <Text style={styles.cTime}>
                    {r.needed_for_date ? formatNeeded(r.needed_for_date) : "—"}
                  </Text>
                  <View style={styles.cClient}>
                    <Text style={styles.client}>{r.client_name}</Text>
                    <Text style={styles.phone}>{r.client_phone ?? ""}</Text>
                  </View>
                  <Text style={styles.cRecipient}>{r.delivery_name ?? "—"}</Text>
                  <Text style={styles.cAddr}>{r.delivery_address ?? "—"}</Text>
                  <Text style={styles.cItems}>
                    {r.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}
                  </Text>
                  <Text style={[styles.cBox, styles.center]}>{r.box_count}</Text>
                  <Text style={[styles.cTotal, styles.right]}>${r.total}</Text>
                  <Text style={[styles.cPaid, r.paid_status === "unpaid" && styles.unpaid]}>
                    {r.paid_status}
                  </Text>
                </View>
              ))}
              {rows.length === 0 && <Empty>No deliveries for this range.</Empty>}
            </ScrollView>
          </ScrollView>
        ) : deliveries.isLoading ? (
          <Loading />
        ) : deliveries.isError ? (
          <ErrorText>Couldn't load the manifest.</ErrorText>
        ) : (
          <Empty>No data cached yet — connect once to load deliveries.</Empty>
        )}
      </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  staleBanner: {
    marginHorizontal: spacing.l,
    marginTop: spacing.m,
    padding: spacing.s,
    borderRadius: radius.m,
    backgroundColor: colors.warn,
  },
  staleText: { color: "#fff", fontSize: 12, fontWeight: "600", textAlign: "center" },
  tabs: { flexDirection: "row", gap: spacing.xs },
  tab: { paddingHorizontal: spacing.m, paddingVertical: spacing.s, borderRadius: radius.m },
  tabActive: { backgroundColor: colors.bg },
  tabText: { color: colors.textMuted },
  tabTextActive: { color: colors.text, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.m,
  },
  headRow: { backgroundColor: colors.bg, borderColor: colors.bg },
  h: { color: colors.textMuted, fontWeight: "700", fontSize: 12 },
  cTime: { width: 110, color: colors.text },
  cClient: { width: 140 },
  cRecipient: { width: 110, color: colors.text },
  cAddr: { width: 180, color: colors.text },
  cItems: { width: 240, color: colors.textMuted, fontSize: 13 },
  cBox: { width: 60, color: colors.text },
  cTotal: { width: 80, color: colors.text, fontWeight: "700" },
  cPaid: { width: 80, color: colors.text, textTransform: "capitalize" },
  center: { textAlign: "center" },
  right: { textAlign: "right" },
  client: { color: colors.text, fontWeight: "600" },
  phone: { color: colors.textMuted, fontSize: 12 },
  unpaid: { color: colors.warn, fontWeight: "700" },
});
