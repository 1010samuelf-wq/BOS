// Reports (§2D/§11): Daily/Monthly toggle, metric cards (Revenue, Orders,
// Ingredient cost, Profit), Cash/Card/E-transfer breakdown bar, and the expense
// list. Manager+ only (enforced server-side; the rail shows it to everyone but
// the API returns 403 for cashiers).

import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { getDailyReport, getMonthlyReport } from "../../src/api/endpoints";
import type { SalesReport } from "../../src/api/types";
import { RequiresConnection } from "../../src/components/Chrome";
import { Card, ErrorText, Loading, ScreenHeader } from "../../src/components/ui";
import { colors, radius, spacing } from "../../src/components/theme";

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

function BreakdownBar({ report }: { report: SalesReport }) {
  const b = report.payment_breakdown;
  const segs = [
    { label: "Cash", v: parseFloat(b.cash), color: colors.success },
    { label: "Card", v: parseFloat(b.card), color: colors.primary },
    { label: "E-transfer", v: parseFloat(b.etransfer), color: "#3a6ea5" },
    { label: "Unpaid", v: parseFloat(b.unpaid), color: colors.warn },
  ].filter((s) => s.v > 0);
  const total = segs.reduce((a, s) => a + s.v, 0) || 1;
  return (
    <View style={{ gap: spacing.s }}>
      <View style={styles.bar}>
        {segs.map((s) => (
          <View key={s.label} style={{ flex: s.v / total, backgroundColor: s.color }} />
        ))}
      </View>
      <View style={styles.legend}>
        {segs.map((s) => (
          <View key={s.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: s.color }]} />
            <Text style={styles.legendText}>
              {s.label} ${s.v.toFixed(2)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function ReportsScreen() {
  const [mode, setMode] = useState<"daily" | "monthly">("daily");
  const report = useQuery({
    queryKey: ["report", mode],
    queryFn: () => (mode === "daily" ? getDailyReport() : getMonthlyReport()),
  });

  return (
    <RequiresConnection>
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.l, gap: spacing.l }}>
        <ScreenHeader
          title="Reports"
          right={
            <View style={styles.tabs}>
              {(["daily", "monthly"] as const).map((m) => (
                <Pressable
                  key={m}
                  style={[styles.tab, mode === m && styles.tabActive]}
                  onPress={() => setMode(m)}
                >
                  <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                    {m === "daily" ? "Daily" : "Monthly"}
                  </Text>
                </Pressable>
              ))}
            </View>
          }
        />

        {report.isLoading ? (
          <Loading />
        ) : report.isError ? (
          <ErrorText>Reports require Manager access.</ErrorText>
        ) : report.data ? (
          <>
            <View style={styles.metrics}>
              <Metric label="Revenue" value={`$${report.data.revenue}`} />
              <Metric label="Orders" value={String(report.data.order_count)} />
              <Metric label="Ingredient cost" value={`$${report.data.ingredient_cost}`} />
              <Metric
                label="Profit"
                value={`$${report.data.profit}`}
                tone={parseFloat(report.data.profit) < 0 ? colors.danger : colors.success}
              />
            </View>

            <Card>
              <Text style={styles.section}>Payment breakdown</Text>
              <BreakdownBar report={report.data} />
            </Card>

            <Card>
              <Text style={styles.section}>Expenses</Text>
              {report.data.expenses.length === 0 ? (
                <Text style={styles.muted}>No expenses logged.</Text>
              ) : (
                report.data.expenses.map((e) => (
                  <View key={e.id} style={styles.expense}>
                    <Text style={styles.expenseDesc}>{e.description}</Text>
                    <Text style={styles.expenseAmt}>${e.amount}</Text>
                  </View>
                ))
              )}
              <View style={styles.expenseTotal}>
                <Text style={styles.expenseDesc}>Total expenses</Text>
                <Text style={styles.expenseAmt}>${report.data.expenses_total}</Text>
              </View>
            </Card>
          </>
        ) : null}
      </ScrollView>
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
  metrics: { flexDirection: "row", gap: spacing.m },
  metric: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.l,
  },
  metricLabel: { color: colors.textMuted, fontSize: 13 },
  metricValue: { color: colors.text, fontSize: 26, fontWeight: "800", marginTop: spacing.xs },
  section: { fontSize: 15, fontWeight: "700", color: colors.text },
  bar: { flexDirection: "row", height: 24, borderRadius: radius.s, overflow: "hidden", backgroundColor: colors.border },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.m },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: colors.text, fontSize: 13 },
  muted: { color: colors.textMuted },
  expense: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.s,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  expenseDesc: { color: colors.text },
  expenseAmt: { color: colors.text, fontWeight: "700" },
  expenseTotal: { flexDirection: "row", justifyContent: "space-between", paddingTop: spacing.s },
});
