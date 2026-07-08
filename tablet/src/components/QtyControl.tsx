// Per-line quantity control (§2A): tap +/- or type the number directly.

import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radius, spacing } from "./theme";

export function QtyControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (q: number) => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        style={styles.btn}
        onPress={() => onChange(value - 1)}
        disabled={value <= 1}
      >
        <Text style={styles.btnText}>−</Text>
      </Pressable>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={String(value)}
        selectTextOnFocus
        onChangeText={(t) => {
          const n = parseInt(t, 10);
          if (!Number.isNaN(n)) onChange(n);
        }}
      />
      <Pressable style={styles.btn} onPress={() => onChange(value + 1)}>
        <Text style={styles.btnText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  btn: {
    width: 40,
    height: 40,
    borderRadius: radius.s,
    backgroundColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 22, color: colors.text, lineHeight: 24 },
  input: {
    width: 56,
    height: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.s,
    textAlign: "center",
    fontSize: 16,
    backgroundColor: colors.surface,
    color: colors.text,
  },
});
