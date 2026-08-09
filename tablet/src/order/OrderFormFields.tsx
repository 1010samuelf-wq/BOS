// Shared building blocks for taking or editing an order's info + items. Used
// by both the New Order screen (create) and Order Detail's edit mode (update)
// so the two flows can't quietly drift apart from each other.

import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { listCategories, listProductsByCategory, searchProducts } from "../api/endpoints";
import type { Product } from "../api/types";
import { DateField, TimeField } from "../components/DateTimeField";
import { QtyControl } from "../components/QtyControl";
import { colors, radius, spacing } from "../components/theme";
import {
  addCustomItem,
  addProduct,
  lineTotal,
  removeLine,
  setLineNote,
  setQuantity,
  type Draft,
} from "./orderDraft";

export function OrderHeaderFields({ draft, set }: { draft: Draft; set: (patch: Partial<Draft>) => void }) {
  // "Needed for" is date + an OPTIONAL time (not every order has a specific
  // time), derived from the combined ISO string on every render rather than
  // kept as separate state, so this component stays a pure view over `draft`.
  const neededDate = draft.neededFor ? draft.neededFor.split("T")[0] : "";
  const neededTime = draft.neededFor?.includes("T") ? draft.neededFor.split("T")[1].slice(0, 5) : "";
  const setNeededParts = (date: string, time: string) => {
    set({ neededFor: date ? (time ? `${date}T${time}` : date) : null });
  };

  return (
    <View style={styles.card}>
      <View style={styles.rowWrap}>
        <TextInput
          style={[styles.input, styles.grow, { minWidth: 200 }]}
          placeholder="Client name *"
          value={draft.clientName}
          onChangeText={(t) => set({ clientName: t })}
        />
        <TextInput
          style={[styles.input, styles.grow, { minWidth: 140 }]}
          placeholder="Phone"
          keyboardType="phone-pad"
          value={draft.clientPhone}
          onChangeText={(t) => set({ clientPhone: t })}
        />
      </View>

      <View style={styles.rowWrap}>
        <View>
          <Text style={styles.fieldLabel}>Needed for (date)</Text>
          <DateField value={neededDate} onChange={(d) => setNeededParts(d, neededTime)} style={{ width: 160 }} />
        </View>
        <View>
          <Text style={styles.fieldLabel}>Time (optional)</Text>
          <TimeField
            value={neededTime}
            onChange={(t) => setNeededParts(neededDate, t)}
            disabled={!neededDate.trim()}
            style={{ width: 130 }}
          />
        </View>
      </View>

      <View style={styles.toggle}>
        {(["pickup", "delivery"] as const).map((f) => (
          <Pressable
            key={f}
            style={[styles.toggleOpt, draft.fulfillment === f && styles.toggleOptActive]}
            onPress={() => set({ fulfillment: f })}
          >
            <Text style={draft.fulfillment === f ? styles.toggleTextActive : styles.toggleText}>
              {f === "pickup" ? "Pickup" : "Delivery"}
            </Text>
          </Pressable>
        ))}
      </View>

      {draft.fulfillment === "delivery" && (
        <View style={styles.rowWrap}>
          <TextInput
            style={[styles.input, { minWidth: 110, width: 110 }]}
            placeholder="Delivery $"
            keyboardType="decimal-pad"
            value={draft.deliveryPrice}
            onChangeText={(t) => set({ deliveryPrice: t })}
          />
          <TextInput
            style={[styles.input, styles.grow, { minWidth: 180 }]}
            placeholder="Delivery name (recipient)"
            value={draft.deliveryName}
            onChangeText={(t) => set({ deliveryName: t })}
          />
          <TextInput
            style={[styles.input, styles.grow, { minWidth: 200 }]}
            placeholder="Delivery address *"
            value={draft.deliveryAddress}
            onChangeText={(t) => set({ deliveryAddress: t })}
          />
        </View>
      )}

      <TextInput
        style={styles.input}
        placeholder="Card message"
        value={draft.cardMessage}
        onChangeText={(t) => set({ cardMessage: t })}
      />
    </View>
  );
}

export function OrderItemsEditor({
  draft, setDraft,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
}) {
  const [search, setSearch] = useState("");
  // Which category's grid is open; null means none. Tapping the open one closes it.
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [customSave, setCustomSave] = useState(false);

  const results = useQuery({
    queryKey: ["product-search", search],
    queryFn: () => searchProducts(search),
    enabled: search.trim().length >= 2,
    staleTime: 30_000,
  });
  // Category buttons: browsing as an alternative to searching. Only the open
  // category's products are fetched, so a large catalog never loads at once.
  const categories = useQuery({
    queryKey: ["product-categories"],
    queryFn: listCategories,
    staleTime: 5 * 60_000,
  });
  const categoryProducts = useQuery({
    queryKey: ["products-by-category", openCategory],
    queryFn: () => listProductsByCategory(openCategory as string),
    enabled: openCategory !== null,
    staleTime: 60_000,
  });

  const pickProduct = (p: Product) => {
    setDraft((d) => addProduct(d, p));
    setSearch("");
  };
  const customPriceValid = /^\d+(\.\d{1,2})?$/.test(customPrice.trim());
  const addCustom = () => {
    if (!customName.trim() || !customPriceValid) return;
    setDraft((d) => addCustomItem(d, customName.trim(), customPrice.trim(), customSave));
    setCustomName("");
    setCustomPrice("");
    setCustomSave(false);
    setCustomOpen(false);
  };

  return (
    <View style={styles.card}>
      <View style={{ position: "relative", zIndex: 10 }}>
        <TextInput
          style={styles.input}
          placeholder='Search products… (e.g. "cro")'
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
        {search.trim().length >= 2 && (
          <View style={styles.dropdown}>
            {results.isLoading && <ActivityIndicator style={{ padding: spacing.m }} />}
            {(results.data ?? []).map((p: Product) => (
              <Pressable key={p.id} style={styles.dropdownRow} onPress={() => pickProduct(p)}>
                <Text style={styles.dropdownName}>{p.name}</Text>
                <Text style={styles.dropdownPrice}>${p.price}</Text>
              </Pressable>
            ))}
            {results.isSuccess && results.data.length === 0 && (
              <Text style={styles.dropdownEmpty}>No matches</Text>
            )}
          </View>
        )}
      </View>

      {(categories.data ?? []).length > 0 && (
        <View style={styles.categoryRow}>
          {(categories.data ?? []).map((c: string) => (
            <Pressable
              key={c}
              style={[styles.categoryBtn, openCategory === c && styles.categoryBtnOn]}
              onPress={() => setOpenCategory((cur) => (cur === c ? null : c))}
            >
              <Text style={openCategory === c ? styles.categoryTextOn : styles.categoryText}>{c}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {openCategory !== null && (
        categoryProducts.isPending ? (
          <ActivityIndicator style={{ padding: spacing.m }} />
        ) : (categoryProducts.data ?? []).length === 0 ? (
          <Text style={styles.emptyItems}>Nothing in {openCategory} yet.</Text>
        ) : (
          <View style={styles.grid}>
            {(categoryProducts.data ?? []).map((p: Product) => (
              <Pressable key={p.id} style={styles.gridItem} onPress={() => pickProduct(p)}>
                <Text style={styles.gridName}>{p.name}</Text>
                <Text style={styles.gridPrice}>${p.price}</Text>
              </Pressable>
            ))}
          </View>
        )
      )}

      {!customOpen ? (
        <Pressable style={styles.customToggle} onPress={() => setCustomOpen(true)}>
          <Text style={styles.customToggleText}>+ Custom item</Text>
        </Pressable>
      ) : (
        <View style={styles.customForm}>
          <TextInput
            style={[styles.input, styles.grow, { minWidth: 160 }]}
            placeholder="Item name"
            value={customName}
            onChangeText={setCustomName}
          />
          <TextInput
            style={[styles.input, { minWidth: 90, width: 90 }]}
            placeholder="Price"
            keyboardType="decimal-pad"
            value={customPrice}
            onChangeText={setCustomPrice}
          />
          <View style={styles.customSaveRow}>
            <Switch value={customSave} onValueChange={setCustomSave} />
            <Text style={styles.customSaveText}>Save as regular product</Text>
          </View>
          <Pressable
            style={[styles.pill, (!customName.trim() || !customPriceValid) && { opacity: 0.5 }]}
            disabled={!customName.trim() || !customPriceValid}
            onPress={addCustom}
          >
            <Text style={styles.pillText}>Add</Text>
          </Pressable>
          <Pressable
            style={styles.pill}
            onPress={() => { setCustomOpen(false); setCustomName(""); setCustomPrice(""); setCustomSave(false); }}
          >
            <Text style={styles.pillText}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {draft.lines.length === 0 ? (
        <Text style={styles.emptyItems}>No items yet — search or pick a category above.</Text>
      ) : (
        draft.lines.map((line, i) => (
          <View key={`${line.product_id}-${i}`} style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName}>
                {line.product_name}
                {line.product_id === null && (
                  <Text style={styles.customLabel}> · custom{line.saveAsProduct ? ", saved" : ""}</Text>
                )}
              </Text>
              <TextInput
                style={styles.lineNote}
                placeholder="Note for this item…"
                value={line.note}
                onChangeText={(t) => setDraft((d) => setLineNote(d, i, t))}
              />
            </View>
            <QtyControl value={line.quantity} onChange={(q) => setDraft((d) => setQuantity(d, i, q))} />
            <Text style={styles.lineTotal}>${lineTotal(line)}</Text>
            <Pressable onPress={() => setDraft((d) => removeLine(d, i))}>
              <Text style={styles.remove}>✕</Text>
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.l,
    gap: spacing.m,
  },
  rowWrap: { flexDirection: "row", gap: spacing.m, alignItems: "center", flexWrap: "wrap" },
  grow: { flexGrow: 1, flexBasis: 0 },
  fieldLabel: { color: colors.textMuted, fontSize: 11, marginBottom: 2 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.bg,
    minHeight: 44,
  },
  customToggle: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
  },
  customToggleText: { color: colors.text, fontWeight: "600" },
  customForm: { flexDirection: "row", flexWrap: "wrap", gap: spacing.s, alignItems: "center" },
  customSaveRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  customSaveText: { color: colors.textMuted, fontSize: 12 },
  customLabel: { color: colors.textMuted, fontWeight: "400", fontSize: 12 },
  toggle: { flexDirection: "row", borderRadius: radius.m, backgroundColor: colors.bg, padding: 3 },
  toggleOpt: { paddingHorizontal: spacing.l, paddingVertical: spacing.s, borderRadius: radius.s },
  toggleOptActive: { backgroundColor: colors.primary },
  toggleText: { color: colors.textMuted, fontWeight: "600" },
  toggleTextActive: { color: colors.primaryText, fontWeight: "700" },
  dropdown: {
    position: "absolute",
    top: 48,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    elevation: 6,
  },
  dropdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dropdownName: { color: colors.text, fontSize: 15 },
  dropdownPrice: { color: colors.textMuted },
  dropdownEmpty: { padding: spacing.m, color: colors.textMuted },
  emptyItems: { color: colors.textMuted, textAlign: "center", padding: spacing.m },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.s, marginTop: spacing.m },
  categoryBtn: {
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.m,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  categoryBtnOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryText: { color: colors.text, fontSize: 14 },
  categoryTextOn: { color: "#fff", fontSize: 14, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.s, marginTop: spacing.m },
  gridItem: {
    minWidth: 150,
    padding: spacing.m,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  gridName: { fontWeight: "600", color: colors.text, fontSize: 14 },
  gridPrice: { color: colors.textMuted, marginTop: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.m },
  lineName: { fontWeight: "600", color: colors.text, fontSize: 15 },
  lineNote: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 2,
    fontSize: 13,
    color: colors.text,
  },
  lineTotal: { width: 70, textAlign: "right", fontWeight: "700", color: colors.text },
  remove: { color: colors.danger, fontSize: 18, padding: spacing.s },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.s,
  },
  pillText: { color: colors.text },
});
