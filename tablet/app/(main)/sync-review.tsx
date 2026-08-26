// Sync Review (spec: bakery-floor offline mode) — queued actions that
// couldn't sync automatically once back online: either the server rejected
// them outright (e.g. a clock-out that no longer matches server state) or
// flagged a conflict (e.g. an order edited elsewhere while this tablet was
// offline). Nothing here is silently dropped or silently overwritten —
// someone has to look and choose Retry or Discard.

import React from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import type { OutboxEntry } from "../../src/offline/outbox";
import * as outbox from "../../src/offline/outbox";
import { useOutbox } from "../../src/offline/OutboxProvider";
import { Button, Empty, ScreenHeader } from "../../src/components/ui";
import { colors, radius, spacing } from "../../src/components/theme";
import { formatRelative } from "../../src/order/dates";

const TYPE_LABELS: Record<string, string> = {
  "orders.create": "New order",
  "orders.update": "Order edit",
  "orders.cancel": "Order cancellation",
  "orders.mark_paid": "Mark order paid",
  "orders.fulfill": "Mark order fulfilled",
  "orders.add_note": "Order note",
  "orders.toggle_note_done": "Order note update",
  "time.clock_in": "Clock in",
  "time.clock_out": "Clock out",
  "tasks.set_done": "Task update",
};

// Friendlier phrasing for the error codes staff are actually likely to hit
// offline — everything else falls back to the server's own message, which is
// already written for a human (see app/core/errors.py).
function friendlyMessage(entry: OutboxEntry): string {
  const code = entry.last_error?.code;
  if (code === "already_clocked_in") {
    return "This clock-in didn't sync because you were already shown as clocked in on the server — check with a manager before retrying.";
  }
  if (code === "not_clocked_in") {
    return "This clock-out didn't sync because you weren't shown as clocked in on the server — check with a manager before retrying.";
  }
  if (code === "stale_version") {
    return "This order was changed elsewhere while you were offline. Retrying will re-check the latest version.";
  }
  return entry.last_error?.message ?? "This action couldn't be synced.";
}

function ReviewRow({ entry }: { entry: OutboxEntry }) {
  // No local refresh needed after these — OutboxProvider is subscribed to
  // every outbox change and re-renders this screen via useOutbox() itself.
  const discard = () => {
    Alert.alert(
      "Discard this action?",
      "It will not be sent to the server. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => void outbox.remove(entry.client_op_id) },
      ],
    );
  };
  const retry = () => {
    void outbox.updateEntry(entry.client_op_id, { status: "pending", last_error: undefined, current: undefined });
  };

  return (
    <View style={styles.row}>
      <Text style={styles.type}>{TYPE_LABELS[entry.type] ?? entry.type}</Text>
      <Text style={styles.queuedAt}>Queued {formatRelative(new Date(entry.queued_at).getTime())}</Text>
      <Text style={styles.message}>{friendlyMessage(entry)}</Text>
      <View style={styles.actions}>
        <Button label="Retry" tone="primary" onPress={() => void retry()} />
        <Button label="Discard" tone="danger" onPress={discard} />
      </View>
    </View>
  );
}

export default function SyncReviewScreen() {
  const { entries } = useOutbox();
  const problems = entries.filter((e) => e.status === "conflict" || e.status === "rejected");

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Sync review" />
      <ScrollView contentContainerStyle={{ padding: spacing.l, gap: spacing.m }}>
        {problems.length === 0 ? (
          <Empty>Nothing needs review right now.</Empty>
        ) : (
          problems.map((e) => (
            <ReviewRow key={e.client_op_id} entry={e} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: spacing.l,
    gap: spacing.xs,
  },
  type: { fontWeight: "700", color: colors.text, fontSize: 15 },
  queuedAt: { color: colors.textMuted, fontSize: 12 },
  message: { color: colors.text, marginTop: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.s, marginTop: spacing.s },
});
