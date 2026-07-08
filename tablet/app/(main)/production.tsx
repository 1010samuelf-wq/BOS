// Production summary / bake list (§2D/§11): per product, total quantity needed
// across matching orders, contributing order count, current stock on hand, and
// quantity still to bake — with date-range presets and a totals row. Doubles as
// the kitchen prep sheet. Open to any authenticated user (operational).

import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { getProduction } from "../../src/api/endpoints";
import { RequiresConnection } from "../../src/components/Chrome";
import { Empty, Loading, ScreenHeader } from "../../src/components/ui";
import { colors, radius, spacing } from "../../src/components/theme";

type Preset = "today" | "tomorrow" | "week";

function range(preset: Preset): { from: string; to: string } {
  const d = new Date();
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  if (preset === "today") return { from: iso(d), to: iso(d) };
  if (preset === "tomorrow") {
    const t = new Date(d);
    t.setDate(d.getDate() + 1);
    return { from: iso(t), to: iso(t) };
  }
  const end = new Date(d);
  end.setDate(d.getDate() + 6);
  return { from: iso(d), to: iso(end) };
}

export default function ProductionScreen() {
  const [preset, setPreset] = useState<Preset>("today");
  const r = range(preset);
  const prod = useQuery({
    queryKey: ["production", preset],
    queryFn: () => getProduction({ from: r.from, to: r.to }),
  });

  return (
    <RequiresConnection>
      <View style={styles.screen}>
        <ScreenHeader
          title="Production"
          right={
            <View style={styles.tabs}>
              {(["today", "tomorrow", "week"] as Preset[]).map((p) => (
                <Pressable
                  key={p}
                  style={[styles.tab, preset === p && styles.tabActive]}
                  onPress={() => setPreset(p)}
                >
                  <Text style={[styles.tabText, preset === p && styles.tabTextActive]}>
                    {p === "week" ? "This week" : p[0].toUpperCase() + p.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          }
        />
        {prod.isLoading ? (
          <Loading />
        ) : (
          <ScrollView contentContainerStyle={{ padding: spacing.l, gap: spacing.s }}>
            <View style={[styles.row, styles.headRow]}>
              <Text style={[styles.h, styles.cName]}>Product</Text>
              <Text style={[styles.h, styles.cNum]}>Needed</Text>
              <Text style={[styles.h, styles.cNum]}>Orders</Text>
              <Text style={[styles.h, styles.cNum]}>In stock</Text>
              <Text style={[styles.h, styles.cNum, styles.bakeH]}>To bake</Text>
            </View>
            {(prod.data?.rows ?? []).map((row) => (
              <View key={row.product_id} style={styles.row}>
                <Text style={styles.cName}>{row.product_name}</Text>
                <Text style={styles.cNum}>{row.total_quantity}</Text>
                <Text style={styles.cNum}>{row.order_count}</Text>
                <Text style={styles.cNum}>{row.in_stock}</Text>
                <Text style={[styles.cNum, styles.bake]}>{row.to_bake}</Text>
              </View>
            ))}
            {prod.data && prod.data.rows.length > 0 && (
              <View style={[styles.row, styles.totalRow]}>
                <Text style={[styles.cName, styles.totalText]}>TOTAL</Text>
                <Text style={[styles.cNum, styles.totalText]}>{prod.data.total_needed}</Text>
                <Text style={styles.cNum} />
                <Text style={styles.cNum} />
                <Text style={[styles.cNum, styles.bake, styles.totalText]}>{prod.data.total_to_bake}</Text>
              </View>
            )}
            {prod.isSuccess && (prod.data?.rows.length ?? 0) === 0 && <Empty>Nothing to bake for this range.</Empty>}
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
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.m,
  },
  headRow: { backgroundColor: colors.bg, borderColor: colors.bg },
  h: { color: colors.textMuted, fontWeight: "700", fontSize: 12 },
  cName: { flex: 2, color: colors.text },
  cNum: { flex: 1, color: colors.text, textAlign: "right", fontVariant: ["tabular-nums"] },
  bakeH: { color: colors.primary },
  bake: { color: colors.primary, fontWeight: "700" },
  totalRow: { backgroundColor: colors.bg },
  totalText: { fontWeight: "800" },
});
