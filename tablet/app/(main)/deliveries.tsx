// Deliveries manifest (§2A/§11): every delivery order for the day — time needed,
// client, phone, address, items, box count (distinct lines, not summed qty),
// total, paid/unpaid. CSV export/print live on the web dashboard (Phase 5); the
// tablet is the on-the-floor view.

import { useQuery } from "@tanstack/react-query";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { getDeliveries } from "../../src/api/endpoints";
import type { DeliveryRow } from "../../src/api/types";
import { RequiresConnection } from "../../src/components/Chrome";
import { Empty, ErrorText, Loading, ScreenHeader } from "../../src/components/ui";
import { colors, radius, spacing } from "../../src/components/theme";

export default function DeliveriesScreen() {
  const deliveries = useQuery({ queryKey: ["deliveries", "today"], queryFn: () => getDeliveries({}) });
  const rows: DeliveryRow[] = deliveries.data?.rows ?? [];

  return (
    <RequiresConnection>
      <View style={styles.screen}>
        <ScreenHeader title="Deliveries — today" />
        {deliveries.isLoading ? (
          <Loading />
        ) : deliveries.isError ? (
          <ErrorText>Couldn't load the manifest.</ErrorText>
        ) : (
          <ScrollView contentContainerStyle={{ padding: spacing.l, gap: spacing.s }}>
            <View style={[styles.row, styles.headRow]}>
              <Text style={[styles.h, styles.cTime]}>Needed</Text>
              <Text style={[styles.h, styles.cClient]}>Client</Text>
              <Text style={[styles.h, styles.cAddr]}>Address</Text>
              <Text style={[styles.h, styles.cItems]}>Items</Text>
              <Text style={[styles.h, styles.cBox]}>Boxes</Text>
              <Text style={[styles.h, styles.cTotal]}>Total</Text>
              <Text style={[styles.h, styles.cPaid]}>Paid</Text>
            </View>
            {rows.map((r) => (
              <View key={r.order_id} style={styles.row}>
                <Text style={styles.cTime}>
                  {r.needed_for_date ? new Date(r.needed_for_date).toLocaleDateString() : "—"}
                </Text>
                <View style={styles.cClient}>
                  <Text style={styles.client}>{r.client_name}</Text>
                  <Text style={styles.phone}>{r.client_phone ?? ""}</Text>
                </View>
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
            {deliveries.isSuccess && rows.length === 0 && <Empty>No deliveries today.</Empty>}
          </ScrollView>
        )}
      </View>
    </RequiresConnection>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
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
  cTime: { width: 90, color: colors.text },
  cClient: { width: 130 },
  cAddr: { flex: 2, color: colors.text },
  cItems: { flex: 3, color: colors.textMuted, fontSize: 13 },
  cBox: { width: 50, color: colors.text },
  cTotal: { width: 70, color: colors.text, fontWeight: "700" },
  cPaid: { width: 70, color: colors.text, textTransform: "capitalize" },
  center: { textAlign: "center" },
  right: { textAlign: "right" },
  client: { color: colors.text, fontWeight: "600" },
  phone: { color: colors.textMuted, fontSize: 12 },
  unpaid: { color: colors.warn, fontWeight: "700" },
});
