// Main shell (§11): persistent side rail (Orders, Stock, Reports, Employees,
// Time, Tasks, Notifications w/ badge) + current-user chip, offline banner and
// toast stack overlaying every screen.

import { useQuery } from "@tanstack/react-query";
import { Redirect, Slot, router, usePathname } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { unreadCount } from "../../src/api/endpoints";
import { useAuth } from "../../src/auth/AuthContext";
import { OfflineBanner, ToastStack } from "../../src/components/Chrome";
import { colors, radius, spacing } from "../../src/components/theme";

const RAIL = [
  { href: "/(main)/orders", label: "Orders", icon: "🧾" },
  { href: "/(main)/production", label: "Bake list", icon: "🥐" },
  { href: "/(main)/deliveries", label: "Deliveries", icon: "🚚" },
  { href: "/(main)/stock", label: "Stock", icon: "📦" },
  { href: "/(main)/reports", label: "Reports", icon: "📊" },
  { href: "/(main)/employees", label: "Employees", icon: "👥" },
  { href: "/(main)/time", label: "Time", icon: "⏱️" },
  { href: "/(main)/tasks", label: "Tasks", icon: "✅" },
  { href: "/(main)/notifications", label: "Alerts", icon: "🔔" },
] as const;

export default function MainLayout() {
  const { user, ready, logout } = useAuth();
  const pathname = usePathname();
  const unread = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: unreadCount,
    refetchInterval: 60_000, // badge safety net; WS invalidation is primary
    enabled: !!user,
  });

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <View style={styles.root}>
      <View style={styles.rail}>
        <Text style={styles.brand}>BOS</Text>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.railScroll} showsVerticalScrollIndicator={false}>
          {RAIL.map((item) => {
            const active = pathname.startsWith(item.href.replace("/(main)", ""));
            const badge = item.label === "Alerts" ? (unread.data?.unread ?? 0) : 0;
            return (
              <Pressable
                key={item.href}
                style={[styles.railItem, active && styles.railItemActive]}
                onPress={() => router.navigate(item.href as never)}
              >
                <Text style={styles.railIcon}>{item.icon}</Text>
                <Text style={[styles.railLabel, active && styles.railLabelActive]}>
                  {item.label}
                </Text>
                {badge > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge > 99 ? "99+" : badge}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable style={styles.user} onPress={() => void logout()}>
          <Text style={styles.userName}>{user.name}</Text>
          <Text style={styles.userAction}>log out</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        <OfflineBanner />
        <Slot />
      </View>
      <ToastStack />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: colors.bg },
  rail: {
    width: 132,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: spacing.l,
    alignItems: "stretch",
  },
  railScroll: { gap: spacing.xs, paddingBottom: spacing.m },
  brand: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.primary,
    textAlign: "center",
    marginBottom: spacing.l,
  },
  railItem: {
    alignItems: "center",
    paddingVertical: spacing.m,
    marginHorizontal: spacing.s,
    borderRadius: radius.m,
  },
  railItemActive: { backgroundColor: colors.bg },
  railIcon: { fontSize: 22 },
  railLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  railLabelActive: { color: colors.text, fontWeight: "600" },
  badge: {
    position: "absolute",
    top: 4,
    right: 16,
    backgroundColor: colors.danger,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  user: {
    alignItems: "center",
    padding: spacing.m,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  userName: { fontWeight: "600", color: colors.text },
  userAction: { fontSize: 11, color: colors.textMuted },
  content: { flex: 1 },
});
