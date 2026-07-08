// PIN login for the shared shift device (§2E): tap your name on the roster,
// enter your PIN. Employees whose PIN isn't set yet go through first-login
// setup (choose PIN, confirm it) — Admin never picks it for them.

import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ApiRequestError } from "../src/api/client";
import { fetchRoster } from "../src/api/endpoints";
import type { RosterEntry } from "../src/api/types";
import { useAuth } from "../src/auth/AuthContext";
import { colors, radius, spacing } from "../src/components/theme";

const PIN_LENGTH = 4;

function PinPad({ onDigit, onBackspace }: { onDigit: (d: string) => void; onBackspace: () => void }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  return (
    <View style={styles.pad}>
      {keys.map((k, i) => (
        <Pressable
          key={i}
          style={[styles.key, k === "" && { opacity: 0 }]}
          disabled={k === ""}
          onPress={() => (k === "⌫" ? onBackspace() : onDigit(k))}
        >
          <Text style={styles.keyText}>{k}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Dots({ filled }: { filled: number }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: PIN_LENGTH }).map((_, i) => (
        <View key={i} style={[styles.dot, i < filled && styles.dotFilled]} />
      ))}
    </View>
  );
}

export default function Login() {
  const roster = useQuery({ queryKey: ["roster"], queryFn: fetchRoster });
  const { login, setupPin } = useAuth();

  const [selected, setSelected] = useState<RosterEntry | null>(null);
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState<string | null>(null); // setup: first entry awaiting confirm
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setSelected(null);
    setPin("");
    setFirstPin(null);
    setError(null);
  };

  const submit = async (fullPin: string) => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      if (!selected.pin_set) {
        if (firstPin === null) {
          setFirstPin(fullPin);
          setPin("");
          setBusy(false);
          return;
        }
        if (firstPin !== fullPin) {
          setError("PINs don't match — start over.");
          setFirstPin(null);
          setPin("");
          setBusy(false);
          return;
        }
        await setupPin(selected.id, fullPin);
      } else {
        await login(selected.id, fullPin);
      }
      router.replace("/(main)/orders");
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Could not reach the server.");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const onDigit = (d: string) => {
    if (busy || pin.length >= PIN_LENGTH) return;
    const next = pin + d;
    setPin(next);
    if (next.length === PIN_LENGTH) void submit(next);
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Bakery Operations</Text>

      {!selected ? (
        <View style={styles.card}>
          <Text style={styles.subtitle}>Who's working?</Text>
          {roster.isLoading && <ActivityIndicator />}
          {roster.isError && (
            <Text style={styles.error}>Server unreachable — check the connection.</Text>
          )}
          <FlatList
            data={roster.data ?? []}
            keyExtractor={(e) => String(e.id)}
            numColumns={2}
            columnWrapperStyle={{ gap: spacing.m }}
            contentContainerStyle={{ gap: spacing.m }}
            renderItem={({ item }) => (
              <Pressable style={styles.person} onPress={() => setSelected(item)}>
                <Text style={styles.personName}>{item.name}</Text>
                <Text style={styles.personRole}>
                  {item.role}
                  {!item.pin_set ? " · set your PIN" : ""}
                </Text>
              </Pressable>
            )}
          />
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.subtitle}>
            {selected.pin_set
              ? `Hi ${selected.name} — enter your PIN`
              : firstPin === null
                ? `Welcome ${selected.name} — choose a PIN`
                : "Confirm your new PIN"}
          </Text>
          <Dots filled={pin.length} />
          {busy && <ActivityIndicator />}
          {error && <Text style={styles.error}>{error}</Text>}
          <PinPad onDigit={onDigit} onBackspace={() => setPin(pin.slice(0, -1))} />
          <Pressable onPress={reset}>
            <Text style={styles.back}>← back to roster</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.l,
  },
  title: { fontSize: 28, fontWeight: "700", color: colors.text },
  subtitle: { fontSize: 18, color: colors.text, textAlign: "center" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    padding: spacing.xl,
    width: 440,
    maxHeight: "75%",
    gap: spacing.l,
    borderWidth: 1,
    borderColor: colors.border,
  },
  person: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.m,
    padding: spacing.l,
    borderWidth: 1,
    borderColor: colors.border,
  },
  personName: { fontSize: 17, fontWeight: "600", color: colors.text },
  personRole: { color: colors.textMuted, marginTop: 2 },
  dots: { flexDirection: "row", justifyContent: "center", gap: spacing.m },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.textMuted,
  },
  dotFilled: { backgroundColor: colors.primary, borderColor: colors.primary },
  pad: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.m,
  },
  key: {
    width: 88,
    height: 64,
    borderRadius: radius.m,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  keyText: { fontSize: 24, color: colors.text },
  error: { color: colors.danger, textAlign: "center" },
  back: { color: colors.textMuted, textAlign: "center", padding: spacing.s },
});
