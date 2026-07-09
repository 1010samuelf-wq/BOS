// Stock screen (§2B/§11): Ingredients vs Products tabs, name search, low/negative
// banner, color-coded rows (green ok / amber low / red negative) with inline
// +/- adjust and a Log purchase modal. Rows may show negative — stock never
// blocks a sale.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiRequestError } from "../../src/api/client";
import { adjustStock, getStock } from "../../src/api/endpoints";
import type { ItemType, StockLevel } from "../../src/api/types";
import { RequiresConnection } from "../../src/components/Chrome";
import { Button, Card, ErrorText, Loading, ScreenHeader } from "../../src/components/ui";
import { colors, radius, spacing } from "../../src/components/theme";

function rowTone(s: StockLevel): string {
  const qty = parseFloat(s.quantity);
  if (qty < 0) return colors.danger;
  if (s.is_low) return colors.warn;
  return colors.success;
}

export default function StockScreen() {
  const [tab, setTab] = useState<ItemType>("ingredient");
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [purchase, setPurchase] = useState<StockLevel | null>(null);
  const [purchaseQty, setPurchaseQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const stock = useQuery({
    queryKey: ["stock", tab, lowOnly, search],
    queryFn: () => getStock({ item_type: tab, low_only: lowOnly, q: search || undefined }),
  });

  const adjust = useMutation({
    mutationFn: (v: { s: StockLevel; delta: string; reason: string }) =>
      adjustStock({ item_type: v.s.item_type, item_id: v.s.item_id, delta: v.delta, reason: v.reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stock"] }),
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Adjustment failed."),
  });

  const rows: StockLevel[] = stock.data ?? [];
  const lowCount = rows.filter((r) => r.is_low || parseFloat(r.quantity) < 0).length;

  return (
    <RequiresConnection>
      <View style={styles.screen}>
        <ScreenHeader
          title="Stock"
          right={
            <View style={styles.tabs}>
              {(["ingredient", "product"] as ItemType[]).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.tab, tab === t && styles.tabActive]}
                  onPress={() => setTab(t)}
                >
                  <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                    {t === "ingredient" ? "Ingredients" : "Products"}
                  </Text>
                </Pressable>
              ))}
            </View>
          }
        />

        <View style={styles.controls}>
          <TextInput
            style={styles.search}
            placeholder="Search by name…"
            value={search}
            onChangeText={setSearch}
          />
          <Pressable
            style={[styles.lowToggle, lowOnly && styles.lowToggleOn]}
            onPress={() => setLowOnly((v) => !v)}
          >
            <Text style={lowOnly ? styles.lowToggleTextOn : styles.lowToggleText}>Low / negative only</Text>
          </Pressable>
        </View>

        {lowCount > 0 && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>⚠ {lowCount} item(s) low or negative</Text>
          </View>
        )}
        {error && <ErrorText>{error}</ErrorText>}

        {stock.isLoading ? (
          <Loading />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(s) => `${s.item_type}-${s.item_id}`}
            contentContainerStyle={{ padding: spacing.l, gap: spacing.s }}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={[styles.dot, { backgroundColor: rowTone(item) }]} />
                <Text style={styles.name}>{item.name ?? `#${item.item_id}`}</Text>
                <Text style={[styles.qty, { color: rowTone(item) }]}>{item.quantity}</Text>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => adjust.mutate({ s: item, delta: "-1", reason: "manual −1" })}
                >
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => adjust.mutate({ s: item, delta: "1", reason: "manual +1" })}
                >
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
                <Button
                  label="Purchase"
                  tone="neutral"
                  onPress={() => {
                    setPurchase(item);
                    setPurchaseQty("");
                  }}
                />
              </View>
            )}
            ListEmptyComponent={stock.isSuccess ? <Text style={styles.empty}>Nothing here.</Text> : null}
          />
        )}
      </View>

      {/* Log purchase (restock) */}
      <Modal transparent visible={!!purchase} animationType="fade">
        <View style={styles.modalWrap}>
          <Card style={styles.modal}>
            <Text style={styles.modalTitle}>Log purchase — {purchase?.name}</Text>
            <TextInput
              style={styles.search}
              placeholder="Quantity received (e.g. 25)"
              keyboardType="decimal-pad"
              value={purchaseQty}
              onChangeText={setPurchaseQty}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Button label="Cancel" tone="neutral" onPress={() => setPurchase(null)} />
              <Button
                label="Add to stock"
                tone="success"
                disabled={!/^\d+(\.\d+)?$/.test(purchaseQty.trim())}
                onPress={() => {
                  if (purchase) adjust.mutate({ s: purchase, delta: purchaseQty.trim(), reason: "purchase" });
                  setPurchase(null);
                }}
              />
            </View>
          </Card>
        </View>
      </Modal>
    </RequiresConnection>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  tabs: { flexDirection: "row", gap: spacing.xs },
  tab: { paddingHorizontal: spacing.m, paddingVertical: spacing.s, borderRadius: radius.m },
  tabActive: { backgroundColor: colors.bg },
  tabText: { color: colors.textMuted },
  tabTextActive: { color: colors.text, fontWeight: "600" },
  controls: { flexDirection: "row", gap: spacing.m, padding: spacing.l, paddingBottom: 0 },
  search: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  lowToggle: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    justifyContent: "center",
  },
  lowToggleOn: { backgroundColor: colors.warn, borderColor: colors.warn },
  lowToggleText: { color: colors.textMuted },
  lowToggleTextOn: { color: "#fff", fontWeight: "700" },
  banner: {
    backgroundColor: "#faf3e3",
    marginHorizontal: spacing.l,
    marginTop: spacing.m,
    borderRadius: radius.m,
    padding: spacing.m,
  },
  bannerText: { color: colors.warn, fontWeight: "700" },
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
  dot: { width: 12, height: 12, borderRadius: 6 },
  name: { flex: 1, color: colors.text, fontSize: 15 },
  qty: { width: 90, textAlign: "right", fontWeight: "700", fontVariant: ["tabular-nums"] },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.s,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepText: { fontSize: 20, color: colors.text },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: spacing.xl },
  modalWrap: { flex: 1, backgroundColor: colors.overlay, alignItems: "center", justifyContent: "center" },
  modal: { width: 420 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.m },
});
