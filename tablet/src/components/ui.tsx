// Small shared building blocks so each screen stays focused on its data.

import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import { colors, radius, spacing } from "./theme";

export function ScreenHeader({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.headerRight}>{right}</View>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  tone = "primary",
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  tone?: "primary" | "neutral" | "danger" | "success";
  disabled?: boolean;
  busy?: boolean;
}) {
  const bg = {
    primary: colors.primary,
    neutral: colors.border,
    danger: colors.danger,
    success: colors.success,
  }[tone];
  const fg = tone === "neutral" ? colors.text : "#fff";
  return (
    <Pressable
      style={[styles.btn, { backgroundColor: bg }, (disabled || busy) && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled || busy}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Loading() {
  return <ActivityIndicator style={{ marginTop: spacing.xl }} />;
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return <Text style={styles.error}>{children}</Text>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <Text style={styles.empty}>{children}</Text>;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.l,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  headerRight: { marginLeft: "auto", flexDirection: "row", gap: spacing.m, alignItems: "center" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.l,
    gap: spacing.m,
  },
  btn: {
    borderRadius: radius.m,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontWeight: "700", fontSize: 15 },
  error: { color: colors.danger, textAlign: "center", marginTop: spacing.l },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: spacing.xl },
});
