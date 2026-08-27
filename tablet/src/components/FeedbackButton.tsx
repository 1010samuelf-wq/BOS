// "Feedback" rail button + its popup. Lets anyone on the floor report a problem
// from the screen they're looking at, with the current route attached.
//
// Deliberately built from React Native primitives only (Modal/TextInput/
// Pressable). Anything importing a native module could not ship as an
// over-the-air update — the installed binary wouldn't have it and the app would
// crash on launch.

import { useMutation } from "@tanstack/react-query";
import { usePathname } from "expo-router";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { submitFeedback } from "../api/endpoints";
import { colors, radius, spacing } from "./theme";
import { Button } from "./ui";

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const pathname = usePathname();

  const mutation = useMutation({
    mutationFn: () =>
      submitFeedback({ message: message.trim(), source: "tablet", context: pathname }),
    onSuccess: () => {
      setSent(true);
      setMessage("");
    },
  });

  function close() {
    setOpen(false);
    setSent(false);
    mutation.reset();
  }

  return (
    <>
      <Pressable style={styles.railItem} onPress={() => setOpen(true)}>
        <Text style={styles.railIcon}>💬</Text>
        <Text style={styles.railLabel}>Feedback</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            {sent ? (
              <>
                <Text style={styles.title}>Thanks — that's been sent.</Text>
                <Text style={styles.hint}>It's saved for the team to read.</Text>
                <View style={styles.actions}>
                  <Button label="Close" onPress={close} />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.title}>Send feedback</Text>
                <Text style={styles.hint}>
                  A problem, something confusing, or an idea.
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="What's happening?"
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={5}
                  maxLength={2000}
                  autoFocus
                  textAlignVertical="top"
                />
                {mutation.isError && (
                  <Text style={styles.error}>
                    Couldn't send that — check the connection and try again.
                  </Text>
                )}
                <View style={styles.actions}>
                  <Button label="Cancel" tone="neutral" onPress={close} />
                  <Button
                    label={mutation.isPending ? "Sending…" : "Send"}
                    onPress={() => mutation.mutate()}
                    disabled={!message.trim()}
                    busy={mutation.isPending}
                  />
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  railItem: {
    alignItems: "center",
    paddingVertical: spacing.m,
    marginHorizontal: spacing.s,
    borderRadius: radius.m,
  },
  railIcon: { fontSize: 22 },
  railLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.l,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    padding: spacing.l,
    gap: spacing.s,
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  hint: { fontSize: 13, color: colors.textMuted },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    padding: spacing.m,
    minHeight: 120,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  error: { color: colors.danger, fontSize: 13 },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.s,
    marginTop: spacing.xs,
  },
});
