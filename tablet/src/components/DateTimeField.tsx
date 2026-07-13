// Tappable date/time fields backed by the native Android picker dialog
// (@react-native-community/datetimepicker, pinned to the exact version Expo
// SDK 52 bundles - see node_modules/expo/bundledNativeModules.json). Android
// shows the picker as a one-shot dialog: mount it on tap, it fires onChange
// once, then unmount.

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import RNDateTimePicker from "@react-native-community/datetimepicker";

import { colors, radius, spacing } from "./theme";

const pad = (n: number) => String(n).padStart(2, "0");

interface FieldProps {
  value: string; // "" | "YYYY-MM-DD" (DateField) | "HH:MM" (TimeField)
  onChange: (v: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

export function DateField({ value, onChange, placeholder, style, disabled }: FieldProps) {
  const [show, setShow] = useState(false);
  const dateObj = value ? new Date(`${value}T00:00:00`) : new Date();
  return (
    <>
      <Pressable
        style={[styles.field, style, disabled && styles.disabled]}
        disabled={disabled}
        onPress={() => setShow(true)}
      >
        <Text style={value ? styles.text : styles.placeholder}>{value || placeholder || "Select date"}</Text>
      </Pressable>
      {show && (
        <RNDateTimePicker
          value={dateObj}
          mode="date"
          display="default"
          onChange={(event, selected) => {
            setShow(false);
            if (event.type === "set" && selected) {
              onChange(`${selected.getFullYear()}-${pad(selected.getMonth() + 1)}-${pad(selected.getDate())}`);
            }
          }}
        />
      )}
    </>
  );
}

export function TimeField({ value, onChange, placeholder, style, disabled }: FieldProps) {
  const [show, setShow] = useState(false);
  const dateObj = value ? new Date(`2000-01-01T${value}:00`) : new Date();
  return (
    <>
      <Pressable
        style={[styles.field, style, disabled && styles.disabled]}
        disabled={disabled}
        onPress={() => setShow(true)}
      >
        <Text style={value ? styles.text : styles.placeholder}>{value || placeholder || "Select time"}</Text>
      </Pressable>
      {show && (
        <RNDateTimePicker
          value={dateObj}
          mode="time"
          display="default"
          onChange={(event, selected) => {
            setShow(false);
            if (event.type === "set" && selected) {
              onChange(`${pad(selected.getHours())}:${pad(selected.getMinutes())}`);
            }
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    backgroundColor: colors.bg,
    minHeight: 44,
    justifyContent: "center",
  },
  disabled: { opacity: 0.5 },
  text: { color: colors.text, fontSize: 15 },
  placeholder: { color: colors.textMuted, fontSize: 15 },
});
