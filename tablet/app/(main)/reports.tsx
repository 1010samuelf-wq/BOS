// Reports (§2D/§11): Daily/Monthly toggle, metric cards (Revenue, Orders,
// Ingredient cost, Profit), Cash/Card/E-transfer breakdown bar, and the expense
// list. Manager+ only (enforced server-side; the rail shows it to everyone but
// the API returns 403 for cashiers).

import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { getDailyReport, getMonthlyReport, listOrders } from "../../src/api/endpoints";
import type { ExpenseOut, Order, SalesReport } from "../../src/api/types";
import { RequiresConnection } from "../../src/components/Chrome";
import { Card, ErrorText, Loading, ScreenHeader } from "../../src/components/ui";
import { colors, radius, spacing } from "../../src/components/theme";

interface Drill {
  label: string;
  params: { payment_method?: string; paid_status?: string; exclude_cancelled?: boolean };
}

// Drill-down (§2D): tapping a metric or a breakdown segment expands the
// itemized orders behind that number.
function DrillPanel({ report, drill, onClose }: { report: SalesReport; drill: Drill; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["report-drill", report.from_date, report.to_date, drill.label],
    queryFn: () => listOrders({ from: report.from_date, to: report.to_date, limit: 200, ...drill.params }),
  });
  const rows: Order[] = q.data?.items ?? [];
  return (
    <Card>
      <View style={styles.drillHeader}>
        <Text style={styles.section}>{drill.label}</Text>
        <Pressable style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>Close</Text>
        </Pressable>
      </View>
      {q.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Text style={styles.muted}>No matching orders.</Text>
      ) : (
        rows.map((o) => (
          <Pressable
            key={o.id}
            style={styles.drillRow}
            onPress={() => router.navigate(`/(main)/orders/${o.id}` as never)}
          >
            <Text style={[styles.drillCell, { width: 50 }]}>#{o.id}</Text>
            <Text style={[styles.drillCell, { flex: 1 }]}>{o.client_name}</Text>
            <Text style={[styles.drillCell, { width: 100, textTransform: "capitalize" }]}>
              {o.status.replace("_", " ")}
            </Text>
            <Text style={[styles.drillCell, { width: 110 }]}>
              {o.paid_status}
              {o.payment_method ? ` · ${o.payment_method}` : ""}
            </Text>
            <Text style={[styles.drillCell, { width: 70, fontWeight: "700", textAlign: "right" }]}>
              ${o.total}
            </Text>
          </Pressable>
        ))
      )}
    </Card>
  );
}

function Metric({
  label,
  value,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  tone?: string;
  onPress?: () => void;
}) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper style={styles.metric} onPress={onPress}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Text>
    </Wrapper>
  );
}

function breakdownSegments(report: SalesReport) {
  const b = report.payment_breakdown;
  return [
    { label: "Cash", v: parseFloat(b.cash), color: colors.success, drill: { payment_method: "cash" } },
    { label: "Card", v: parseFloat(b.card), color: colors.primary, drill: { payment_method: "card" } },
    { label: "E-transfer", v: parseFloat(b.etransfer), color: "#3a6ea5", drill: { payment_method: "etransfer" } },
    { label: "Unpaid", v: parseFloat(b.unpaid), color: colors.warn, drill: { paid_status: "unpaid" } },
  ];
}

function BreakdownBar({ report, onDrill }: { report: SalesReport; onDrill: (d: Drill) => void }) {
  const all = breakdownSegments(report);
  const segs = all.filter((s) => s.v > 0);
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
          <Pressable
            key={s.label}
            style={styles.legendItem}
            onPress={() => onDrill({ label: `${s.label} — orders`, params: s.drill })}
          >
            <View style={[styles.legendDot, { backgroundColor: s.color }]} />
            <Text style={styles.legendText}>
              {s.label} ${s.v.toFixed(2)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function ReportsScreen() {
  const [mode, setMode] = useState<"daily" | "monthly">("daily");
  const [drill, setDrill] = useState<Drill | null>(null);
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
              <Metric
                label="Revenue"
                value={`$${report.data.revenue}`}
                onPress={() => setDrill({ label: "Revenue — orders", params: { exclude_cancelled: true } })}
              />
              <Metric
                label="Orders"
                value={String(report.data.order_count)}
                onPress={() => setDrill({ label: "Orders", params: { exclude_cancelled: true } })}
              />
              <Metric label="Ingredient cost" value={`$${report.data.ingredient_cost}`} />
              <Metric
                label="Profit"
                value={`$${report.data.profit}`}
                tone={parseFloat(report.data.profit) < 0 ? colors.danger : colors.success}
              />
            </View>

            {drill && <DrillPanel report={report.data} drill={drill} onClose={() => setDrill(null)} />}

            <Card>
              <Text style={styles.section}>Payment breakdown</Text>
              <BreakdownBar report={report.data} onDrill={setDrill} />
            </Card>

            <Card>
              <Text style={styles.section}>Expenses</Text>
              {report.data.expenses.length === 0 ? (
                <Text style={styles.muted}>No expenses logged.</Text>
              ) : (
                report.data.expenses.map((e: ExpenseOut) => (
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
  drillHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  closeBtn: { paddingHorizontal: spacing.m, paddingVertical: spacing.xs, borderRadius: radius.m, backgroundColor: colors.bg },
  closeBtnText: { color: colors.textMuted, fontWeight: "600" },
  drillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    paddingVertical: spacing.s,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  drillCell: { color: colors.text, fontSize: 13 },
});
