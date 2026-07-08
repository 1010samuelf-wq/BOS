// Employee hours + clock in/out (§2G/§11): the current user's Mon–Sun grid and
// weekly total, a clock in/out button reflecting the open shift, and (for Admin)
// an all-staff weekly totals table.
//
// Clock-in/out is deliberately tablet-only (§1) — it's a physical shift action.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { ApiRequestError } from "../../src/api/client";
import { clockIn, clockOut, getHours, getStaffHours } from "../../src/api/endpoints";
import { useAuth } from "../../src/auth/AuthContext";
import { RequiresConnection } from "../../src/components/Chrome";
import { Button, Card, ErrorText, Loading, ScreenHeader } from "../../src/components/ui";
import { colors, radius, spacing } from "../../src/components/theme";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function TimeScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const hours = useQuery({ queryKey: ["hours", "me"], queryFn: () => getHours({}) });
  const staff = useQuery({
    queryKey: ["hours", "staff"],
    queryFn: () => getStaffHours(),
    enabled: isAdmin,
  });

  const punch = useMutation({
    mutationFn: (open: boolean) => (open ? clockOut() : clockIn()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hours"] }),
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Clock action failed."),
  });

  const open = !!hours.data?.open_entry;

  return (
    <RequiresConnection>
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.l, gap: spacing.l }}>
        <ScreenHeader
          title="Time"
          right={
            <Button
              label={open ? "Clock out" : "Clock in"}
              tone={open ? "danger" : "success"}
              busy={punch.isPending}
              onPress={() => punch.mutate(open)}
            />
          }
        />
        {error && <ErrorText>{error}</ErrorText>}

        <Card>
          <Text style={styles.section}>My week</Text>
          {hours.isLoading ? (
            <Loading />
          ) : hours.data ? (
            <>
              <View style={styles.grid}>
                {hours.data.days.map((d, i) => (
                  <View key={d.day} style={styles.dayCell}>
                    <Text style={styles.dayLabel}>{DAYS[i]}</Text>
                    <Text style={styles.dayHours}>{d.hours.toFixed(1)}</Text>
                  </View>
                ))}
                <View style={[styles.dayCell, styles.totalCell]}>
                  <Text style={styles.dayLabel}>Total</Text>
                  <Text style={styles.totalHours}>{hours.data.total_hours.toFixed(1)}</Text>
                </View>
              </View>
              <Text style={styles.status}>
                {open ? "● Clocked in now" : "Not clocked in"}
              </Text>
            </>
          ) : null}
        </Card>

        {isAdmin && (
          <Card>
            <Text style={styles.section}>All staff — this week</Text>
            {staff.isLoading ? (
              <Loading />
            ) : (
              (staff.data?.rows ?? []).map((r) => (
                <View key={r.user_id} style={styles.staffRow}>
                  <Text style={styles.staffName}>{r.name}</Text>
                  <Text style={styles.staffHours}>{r.total_hours.toFixed(1)} h</Text>
                </View>
              ))
            )}
            {staff.data && (
              <View style={[styles.staffRow, styles.grand]}>
                <Text style={styles.staffName}>Total</Text>
                <Text style={styles.staffHours}>{staff.data.grand_total_hours.toFixed(1)} h</Text>
              </View>
            )}
          </Card>
        )}
      </ScrollView>
    </RequiresConnection>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  section: { fontSize: 15, fontWeight: "700", color: colors.text },
  grid: { flexDirection: "row", gap: spacing.s },
  dayCell: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.m,
    padding: spacing.m,
    alignItems: "center",
  },
  totalCell: { backgroundColor: colors.primary },
  dayLabel: { color: colors.textMuted, fontSize: 12 },
  dayHours: { color: colors.text, fontWeight: "700", fontSize: 18, marginTop: 2 },
  totalHours: { color: "#fff", fontWeight: "800", fontSize: 18, marginTop: 2 },
  status: { color: colors.textMuted },
  staffRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.s,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  staffName: { color: colors.text },
  staffHours: { color: colors.text, fontWeight: "700", fontVariant: ["tabular-nums"] },
  grand: { borderBottomWidth: 0, marginTop: spacing.xs },
});
