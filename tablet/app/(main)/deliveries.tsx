// Deliveries manifest (§2A/§11): every delivery order for the day — time needed,
// client, phone, address, items, box count (distinct lines, not summed qty),
// total, paid/unpaid. CSV export/print live on the web dashboard (Phase 5); the
// tablet is the on-the-floor view.

import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { getDeliveries } from "../../src/api/endpoints";
import type { DeliveryRow } from "../../src/api/types";
import { RequiresConnection } from "../../src/components/Chrome";
import { Empty, ErrorText, Loading, ScreenHeader } from "../../src/components/ui";
import { colors, radius, spacing } from "../../src/components/theme";
import { formatNeeded } from "../../src/order/dates";

type Preset = "today" | "tomorrow" | "week" | "upcoming";

function range(preset: Preset): { from: string; to: string } {
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
  const r = range(preset);
  const deliveries = useQuery({ queryKey: ["deliveries", preset], queryFn: () => getDeliveries(r) });
  const rows: DeliveryRow[] = deliveries.data?.rows ?? [];

  return (
    <RequiresConnection>
      <View style={styles.screen}>
        <ScreenHeader
          title="Deliveries"
          right={
            <View style={styles.tabs}>
              {(["today", "tomorrow", "week", "upcoming"] as Preset[]).map((p) => (
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
        {deliveries.isLoading ? (
          <Loading />
        ) : deliveries.isError ? (
          <ErrorText>Couldn't load the manifest.</ErrorText>
        ) : (
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
              {deliveries.isSuccess && rows.length === 0 && <Empty>No deliveries for this range.</Empty>}
            </ScrollView>
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
