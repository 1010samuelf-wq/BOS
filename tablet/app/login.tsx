// PIN login for the shared shift device (§2E): tap your name on the roster,
// enter your PIN. The roster no longer reveals who has onboarded (spec §6
// hardening), so first-login is discovered reactively: a normal login attempt
// that comes back `pin_not_set` flips the screen into setup mode, where the
// employee enters the one-time code an admin gave them plus a new PIN.

import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiRequestError } from "../src/api/client";
import { fetchRoster } from "../src/api/endpoints";
import type { RosterEntry } from "../src/api/types";
import { useAuth } from "../src/auth/AuthContext";
import { colors, radius, spacing } from "../src/components/theme";

const MIN_PIN = 6;
const MAX_PIN = 8;

type Phase = "enter-pin" | "need-setup-code" | "choose-pin" | "confirm-pin";

function PinPad({
  onDigit,
  onBackspace,
  onEnter,
  enterEnabled,
}: {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
  enterEnabled: boolean;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"];
  return (
    <View style={styles.pad}>
      {keys.map((k, i) => (
        <Pressable
          key={i}
          style={[styles.key, k === "✓" && enterEnabled && styles.keyEnter]}
          disabled={k === "✓" && !enterEnabled}
          onPress={() => {
            if (k === "⌫") onBackspace();
            else if (k === "✓") onEnter();
            else onDigit(k);
          }}
        >
          <Text style={styles.keyText}>{k}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Dots({ length, max }: { length: number; max: number }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: max }).map((_, i) => (
        <View key={i} style={[styles.dot, i < length && styles.dotFilled]} />
      ))}
    </View>
  );
}

export default function Login() {
  const roster = useQuery({ queryKey: ["roster"], queryFn: fetchRoster });
  const { login, setupPin } = useAuth();

  const [selected, setSelected] = useState<RosterEntry | null>(null);
  const [phase, setPhase] = useState<Phase>("enter-pin");
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setSelected(null);
    setPhase("enter-pin");
    setPin("");
    setFirstPin("");
    setSetupCode("");
    setError(null);
  };

  const onDigit = (d: string) => {
    if (busy || pin.length >= MAX_PIN) return;
    setPin(pin + d);
  };
  const onBackspace = () => setPin(pin.slice(0, -1));

  const onEnter = async () => {
    if (!selected || pin.length < MIN_PIN) return;
    setBusy(true);
    setError(null);

    if (phase === "enter-pin") {
      try {
        await login(selected.id, pin);
        router.replace("/(main)/orders");
      } catch (e) {
        if (e instanceof ApiRequestError && e.code === "pin_not_set") {
          setPhase("need-setup-code");
          setPin("");
        } else {
          setError(e instanceof ApiRequestError ? e.message : "Could not reach the server.");
          setPin("");
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    if (phase === "choose-pin") {
      setFirstPin(pin);
      setPin("");
      setPhase("confirm-pin");
      setBusy(false);
      return;
    }

    if (phase === "confirm-pin") {
      if (pin !== firstPin) {
        setError("PINs don't match — start over.");
        setFirstPin("");
        setPin("");
        setPhase("choose-pin");
        setBusy(false);
        return;
      }
      try {
        await setupPin(selected.id, pin, setupCode.trim().toUpperCase());
        router.replace("/(main)/orders");
      } catch (e) {
        setError(e instanceof ApiRequestError ? e.message : "Could not reach the server.");
        setPin("");
        setFirstPin("");
        setPhase("choose-pin");
      } finally {
        setBusy(false);
      }
    }
  };

  const subtitle = (() => {
    if (!selected) return "";
    if (phase === "need-setup-code") return `Welcome ${selected.name} — enter your setup code`;
    if (phase === "choose-pin") return `Choose a new PIN (${MIN_PIN}-${MAX_PIN} digits)`;
    if (phase === "confirm-pin") return "Confirm your new PIN";
    return `Hi ${selected.name} — enter your PIN`;
  })();

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
                <Text style={styles.personRole}>{item.role}</Text>
              </Pressable>
            )}
          />
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.subtitle}>{subtitle}</Text>

          {phase === "need-setup-code" ? (
            <>
              <TextInput
                style={styles.codeInput}
                placeholder="Setup code from your admin"
                value={setupCode}
                onChangeText={(t) => setSetupCode(t.toUpperCase())}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
              />
              <Pressable
                style={[styles.continueBtn, !setupCode.trim() && styles.continueBtnDisabled]}
                disabled={!setupCode.trim()}
                onPress={() => setPhase("choose-pin")}
              >
                <Text style={styles.continueText}>Continue</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Dots length={pin.length} max={MAX_PIN} />
              {busy && <ActivityIndicator />}
              {error && <Text style={styles.error}>{error}</Text>}
              <PinPad
                onDigit={onDigit}
                onBackspace={onBackspace}
                onEnter={onEnter}
                enterEnabled={pin.length >= MIN_PIN && !busy}
              />
            </>
          )}

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
  dots: { flexDirection: "row", justifyContent: "center", gap: spacing.s, flexWrap: "wrap" },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
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
  keyEnter: { backgroundColor: colors.primary, borderColor: colors.primary },
  keyText: { fontSize: 24, color: colors.text },
  error: { color: colors.danger, textAlign: "center" },
  back: { color: colors.textMuted, textAlign: "center", padding: spacing.s },
  codeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    padding: spacing.m,
    fontSize: 18,
    textAlign: "center",
    color: colors.text,
  },
  continueBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.m,
    padding: spacing.m,
    alignItems: "center",
  },
  continueBtnDisabled: { opacity: 0.4 },
  continueText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
