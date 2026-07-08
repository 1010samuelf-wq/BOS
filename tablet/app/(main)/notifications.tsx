// Notifications feed (§2H/§11): low/negative stock, overdue orders & tasks.
// Unread emphasized; tap to mark read (and jump to the related order for overdue
// items); mark-all clears the badge. New notifications also arrive as live
// toasts via the realtime provider.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../src/api/endpoints";
import type { Notification } from "../../src/api/types";
import { RequiresConnection } from "../../src/components/Chrome";
import { Button, Empty, Loading, ScreenHeader } from "../../src/components/ui";
import { colors, radius, spacing } from "../../src/components/theme";

const ICON: Record<string, string> = {
  low_stock: "📦",
  overdue_order: "⏰",
  overdue_task: "✅",
};

export default function NotificationsScreen() {
  const queryClient = useQueryClient();
  const feed = useQuery({
    queryKey: ["notifications", "feed"],
    queryFn: () => listNotifications({ limit: 100 }),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const readOne = useMutation({ mutationFn: markNotificationRead, onSuccess: invalidate });
  const readAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: invalidate });

  const onPress = (n: Notification) => {
    if (!n.read) readOne.mutate(n.id);
    if (n.related_order_id) router.navigate(`/(main)/orders/${n.related_order_id}` as never);
  };

  return (
    <RequiresConnection>
      <View style={styles.screen}>
        <ScreenHeader
          title="Notifications"
          right={<Button label="Mark all read" tone="neutral" onPress={() => readAll.mutate()} />}
        />
        {feed.isLoading ? (
          <Loading />
        ) : (
          <FlatList
            data={feed.data?.items ?? []}
            keyExtractor={(n) => String(n.id)}
            contentContainerStyle={{ padding: spacing.l, gap: spacing.s }}
            renderItem={({ item }) => (
              <Pressable style={[styles.row, !item.read && styles.unread]} onPress={() => onPress(item)}>
                <Text style={styles.icon}>{ICON[item.type] ?? "🔔"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.msg, !item.read && styles.msgUnread]}>{item.message}</Text>
                  <Text style={styles.time}>{new Date(item.created_at).toLocaleString()}</Text>
                </View>
                {!item.read && <View style={styles.dot} />}
              </Pressable>
            )}
            ListEmptyComponent={feed.isSuccess ? <Empty>All clear — nothing needs attention.</Empty> : null}
          />
        )}
      </View>
    </RequiresConnection>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.m,
  },
  unread: { borderColor: colors.primary, backgroundColor: "#fdf6f0" },
  icon: { fontSize: 22 },
  msg: { color: colors.text },
  msgUnread: { fontWeight: "700" },
  time: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
});
