// App chrome shared across screens: the offline lock banner (§2F) and the
// notification toast stack (§2H). Rendered once in the main layout.

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useRealtime } from "../realtime/RealtimeProvider";
import { colors, radius, spacing } from "./theme";

export function OfflineBanner() {
  const { online } = useRealtime();
  if (online) return null;
  return (
    <View style={styles.offline}>
      <Text style={styles.offlineText}>
        Offline — reconnect to continue. Order and stock actions are locked.
      </Text>
    </View>
  );
}

/** Blocks interaction with children while the socket is down (spec §1/§2F). */
export function RequiresConnection({ children }: { children: React.ReactNode }) {
  const { online } = useRealtime();
  return (
    <View style={{ flex: 1 }} pointerEvents={online ? "auto" : "none"}>
      <View style={{ flex: 1, opacity: online ? 1 : 0.45 }}>{children}</View>
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
    backgroundColor: colors.danger,
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.l,
  },
  offlineText: { color: "#fff", textAlign: "center", fontWeight: "600" },
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
