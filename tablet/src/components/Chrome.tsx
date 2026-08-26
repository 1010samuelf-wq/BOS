// App chrome shared across screens: the offline/sync-status banner and the
// notification toast stack (§2F/§2H). Rendered once in the main layout.

import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useConnectivity } from "../offline/connectivity";
import { useOutbox } from "../offline/OutboxProvider";
import { useRealtime } from "../realtime/RealtimeProvider";
import { colors, radius, spacing } from "./theme";

export function OfflineBanner() {
  const { isOffline } = useConnectivity();
  const { pendingCount, problemCount } = useOutbox();

  if (problemCount > 0) {
    return (
      <Pressable style={styles.problem} onPress={() => router.navigate("/(main)/sync-review" as never)}>
        <Text style={styles.problemText}>
          {problemCount} change{problemCount === 1 ? "" : "s"} couldn't sync automatically — tap to review
        </Text>
      </Pressable>
    );
  }
  if (!isOffline) return null;
  return (
    <View style={styles.offline}>
      <Text style={styles.offlineText}>
        Offline{pendingCount > 0 ? ` — ${pendingCount} action${pendingCount === 1 ? "" : "s"} queued, will sync when reconnected` : " — you can keep working"}
      </Text>
    </View>
  );
}

/** Blocks interaction with children while offline — reserved for screens that
 * haven't been made offline-capable (admin/back-office: Settings, Employees,
 * Bookkeeping, Notifications). Offline-capable screens (Orders, Production,
 * Deliveries, Time, Tasks) don't use this anymore — they read cached data and
 * queue writes instead. */
export function RequiresConnection({ children }: { children: React.ReactNode }) {
  const { isOffline } = useConnectivity();
  return (
    <View style={{ flex: 1 }} pointerEvents={isOffline ? "none" : "auto"}>
      <View style={{ flex: 1, opacity: isOffline ? 0.45 : 1 }}>{children}</View>
    </View>
  );
}

export function ToastStack() {
  const { toasts, dismissToast } = useRealtime();
  if (toasts.length === 0) return null;
  return (
    <View style={styles.toastStack} pointerEvents="box-none">
      {toasts.map((t) => (
        <Pressable key={t.id} style={styles.toast} onPress={() => dismissToast(t.id)}>
          <Text style={styles.toastText}>{t.message}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  offline: {
    backgroundColor: colors.warn,
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.l,
  },
  offlineText: { color: "#fff", textAlign: "center", fontWeight: "600" },
  problem: {
    backgroundColor: colors.danger,
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.l,
  },
  problemText: { color: "#fff", textAlign: "center", fontWeight: "700" },
  toastStack: {
    position: "absolute",
    top: spacing.l,
    right: spacing.l,
    gap: spacing.s,
    maxWidth: 420,
  },
  toast: {
    backgroundColor: colors.text,
    borderRadius: radius.m,
    padding: spacing.m,
    elevation: 4,
  },
  toastText: { color: "#fff" },
});
