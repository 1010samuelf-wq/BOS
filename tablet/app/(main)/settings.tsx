// Admin / Settings (§2I/§11): the catalog (products, ingredients, recipes) plus
// the business profile (receipt/manifest header) — tablet parity with the web
// dashboard's Settings page. Gated the same way as web: needs the "settings"
// section (admins have it by default; a manager can be granted it).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiRequestError } from "../../src/api/client";
import {
  createIngredient,
  createProduct,
  getBusinessProfile,
  getRecipe,
  listIngredients,
  listProducts,
  searchProducts,
  updateBusinessProfile,
  updateIngredient,
  updateProduct,
  uploadProductPhoto,
  upsertRecipe,
} from "../../src/api/endpoints";
import type { BusinessProfile, Ingredient, Product } from "../../src/api/types";
import { PRODUCT_CATEGORIES } from "../../src/api/types";
import { useAuth } from "../../src/auth/AuthContext";
import { RequiresConnection } from "../../src/components/Chrome";
import { Button, Card, ErrorText, Loading, ScreenHeader } from "../../src/components/ui";
import { colors, radius, spacing } from "../../src/components/theme";

type Section = "products" | "ingredients" | "recipes" | "business";

function useErr() {
  const [error, setError] = useState<string | null>(null);
  const onErr = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : "Action failed.");
  return { error, onErr, clear: () => setError(null) };
}

async function pickPhoto(): Promise<{ uri: string; name: string; type: string } | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("Permission needed", "Allow photo library access to set a product photo.");
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, name: asset.fileName ?? "photo.jpg", type: asset.mimeType ?? "image/jpeg" };
}

function CategoryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.pillsRow}>
      <Pressable style={[styles.pill, value === "" && styles.pillOn]} onPress={() => onChange("")}>
        <Text style={value === "" ? styles.pillTextOn : styles.pillText}>No category</Text>
      </Pressable>
      {PRODUCT_CATEGORIES.map((c) => (
        <Pressable key={c} style={[styles.pill, value === c && styles.pillOn]} onPress={() => onChange(c)}>
          <Text style={value === c ? styles.pillTextOn : styles.pillText}>{c}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function PhotoThumb({ p, onPress, uploading }: { p: Product; onPress: () => void; uploading: boolean }) {
  return (
    <Pressable style={styles.photoCell} onPress={onPress} disabled={uploading}>
      {p.photo_url
        ? <Image source={{ uri: p.photo_url }} style={styles.photoImg} />
        : <Text style={styles.photoEmpty}>📷</Text>}
    </Pressable>
  );
}

function ProductRow({
  p, invalidate, onErr, uploadingId, setUploadingId,
}: {
  p: Product;
  invalidate: () => void;
  onErr: (e: unknown) => void;
  uploadingId: number | null;
  setUploadingId: (id: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const [price, setPrice] = useState(p.price);
  const [category, setCategory] = useState(p.category ?? "");

  const save = useMutation({
    mutationFn: () => updateProduct(p.id, { name: name.trim(), price: price.trim(), category: category.trim() || null }),
    onSuccess: () => { setEditing(false); invalidate(); },
    onError: onErr,
  });
  const toggleActive = useMutation({
    mutationFn: () => updateProduct(p.id, { active: !p.active }),
    onSuccess: invalidate,
    onError: onErr,
  });
  const uploadPhoto = useMutation({
    mutationFn: (asset: { uri: string; name: string; type: string }) => uploadProductPhoto(p.id, asset),
    onMutate: () => setUploadingId(p.id),
    onSuccess: invalidate,
    onError: onErr,
    onSettled: () => setUploadingId(null),
  });
  const handleUpload = async () => {
    const asset = await pickPhoto();
    if (asset) uploadPhoto.mutate(asset);
  };
  const start = () => { setName(p.name); setPrice(p.price); setCategory(p.category ?? ""); setEditing(true); };
  const validPrice = /^\d+(\.\d{1,2})?$/.test(price.trim());

  return (
    <Card style={{ opacity: p.active ? 1 : 0.5 }}>
      <View style={styles.row}>
        <PhotoThumb p={p} onPress={handleUpload} uploading={uploadingId === p.id} />
        <View style={{ flex: 1, gap: spacing.xs }}>
          {editing ? (
            <>
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Name" />
              <TextInput style={styles.input} value={price} onChangeText={setPrice} placeholder="Price" keyboardType="decimal-pad" />
            </>
          ) : (
            <>
              <Text style={styles.name}>{p.name}{!p.active ? " · inactive" : ""}</Text>
              <Text style={styles.meta}>{p.category ?? "No category"} · ${p.price}</Text>
            </>
          )}
        </View>
        <View style={{ gap: spacing.xs }}>
          {editing ? (
            <>
              <Button label="Save" busy={save.isPending} disabled={!name.trim() || !validPrice} onPress={() => save.mutate()} />
              <Button label="Cancel" tone="neutral" onPress={() => setEditing(false)} />
            </>
          ) : (
            <>
              <Button label="Edit" tone="neutral" onPress={start} />
              <Button label={p.active ? "Deactivate" : "Activate"} tone="neutral" onPress={() => toggleActive.mutate()} />
            </>
          )}
        </View>
      </View>
      {editing && (
        <>
          <Text style={styles.fieldLabel}>Category</Text>
          <CategoryPicker value={category} onChange={setCategory} />
        </>
      )}
    </Card>
  );
}

function ProductsSection() {
  const queryClient = useQueryClient();
  const { error, onErr } = useErr();
  const products = useQuery({ queryKey: ["products", "all"], queryFn: () => listProducts(false) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["products"] });
  const [uploadingId, setUploadingId] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const create = useMutation({
    mutationFn: () => createProduct({ name: name.trim(), price: price.trim(), category: category.trim() || null }),
    onSuccess: () => { setName(""); setPrice(""); setCategory(""); invalidate(); },
    onError: onErr,
  });
  const validPrice = /^\d+(\.\d{1,2})?$/.test(price.trim());

  return (
    <>
      {error && <ErrorText>{error}</ErrorText>}
      <Card>
        <Text style={styles.section}>Add product</Text>
        <TextInput style={styles.input} placeholder="Name" value={name} onChangeText={setName} />
        <TextInput style={styles.input} placeholder="Price (e.g. 3.50)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
        <CategoryPicker value={category} onChange={setCategory} />
        <Button label="Add product" busy={create.isPending} disabled={!name.trim() || !validPrice} onPress={() => create.mutate()} />
        <Text style={styles.hint}>Add the photo afterward — tap the camera icon on its row below.</Text>
      </Card>
      <Text style={styles.sectionTitle}>Catalog</Text>
      {products.isLoading ? (
        <Loading />
      ) : products.isError ? (
        <ErrorText>Settings access required.</ErrorText>
      ) : (products.data ?? []).length === 0 ? (
        <Text style={styles.hint}>No products yet.</Text>
      ) : (
        (products.data ?? []).map((p: Product) => (
          <ProductRow key={p.id} p={p} invalidate={invalidate} onErr={onErr} uploadingId={uploadingId} setUploadingId={setUploadingId} />
        ))
      )}
    </>
  );
}

function IngredientsSection() {
  const queryClient = useQueryClient();
  const { error, onErr } = useErr();
  const ingredients = useQuery({ queryKey: ["ingredients", "all"], queryFn: () => listIngredients() });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["ingredients"] });

  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const [cost, setCost] = useState("");
  const [threshold, setThreshold] = useState("0");
  const create = useMutation({
    mutationFn: () => createIngredient({ name: name.trim(), unit: unit.trim(), cost_per_unit: cost.trim(), low_stock_threshold: threshold.trim() || "0" }),
    onSuccess: () => { setName(""); setCost(""); setThreshold("0"); invalidate(); },
    onError: onErr,
  });
  const toggleActive = useMutation({
    mutationFn: (i: Ingredient) => updateIngredient(i.id, { active: !i.active }),
    onSuccess: invalidate,
    onError: onErr,
  });
  const validCost = /^\d+(\.\d+)?$/.test(cost.trim());

  return (
    <>
      {error && <ErrorText>{error}</ErrorText>}
      <Card>
        <Text style={styles.section}>Add ingredient</Text>
        <TextInput style={styles.input} placeholder="Name" value={name} onChangeText={setName} />
        <View style={styles.row}>
          <TextInput style={[styles.input, { flex: 1 }]} placeholder="Unit (kg/g/unit)" value={unit} onChangeText={setUnit} />
          <TextInput style={[styles.input, { flex: 1 }]} placeholder="Cost / unit" value={cost} onChangeText={setCost} keyboardType="decimal-pad" />
          <TextInput style={[styles.input, { flex: 1 }]} placeholder="Low threshold" value={threshold} onChangeText={setThreshold} keyboardType="decimal-pad" />
        </View>
        <Button label="Add ingredient" busy={create.isPending} disabled={!name.trim() || !validCost} onPress={() => create.mutate()} />
      </Card>
      <Text style={styles.sectionTitle}>Ingredients</Text>
      {ingredients.isLoading ? (
        <Loading />
      ) : ingredients.isError ? (
        <ErrorText>Settings access required.</ErrorText>
      ) : (ingredients.data ?? []).length === 0 ? (
        <Text style={styles.hint}>No ingredients yet.</Text>
      ) : (
        (ingredients.data ?? []).map((i: Ingredient) => (
          <Card key={i.id} style={{ opacity: i.active ? 1 : 0.5 }}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{i.name}{!i.active ? " · inactive" : ""}</Text>
                <Text style={styles.meta}>{i.unit} · ${i.cost_per_unit}/unit · low @ {i.low_stock_threshold}</Text>
              </View>
              <Button label={i.active ? "Deactivate" : "Activate"} tone="neutral" onPress={() => toggleActive.mutate(i)} />
            </View>
          </Card>
        ))
      )}
    </>
  );
}

function RecipesSection() {
  const client = useQueryClient();
  const { error, onErr } = useErr();
  const [productSearch, setProductSearch] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [items, setItems] = useState<{ ingredient_id: number; quantity: string }[]>([]);
  const [yieldQty, setYieldQty] = useState("1");

  const productResults = useQuery({
    queryKey: ["product-search", productSearch],
    queryFn: () => searchProducts(productSearch),
    enabled: productSearch.trim().length >= 2,
  });
  const ingredients = useQuery({ queryKey: ["ingredients", "active"], queryFn: () => listIngredients(true) });

  const recipe = useQuery({
    queryKey: ["recipe", product?.id],
    queryFn: () => getRecipe(product!.id),
    enabled: product !== null,
    retry: false,
  });

  useEffect(() => {
    if (product === null) { setItems([]); setYieldQty("1"); return; }
    if (recipe.data) {
      setItems(recipe.data.items.map((i: { ingredient_id: number; quantity: string }) => ({ ingredient_id: i.ingredient_id, quantity: i.quantity })));
      setYieldQty(String(recipe.data.yield_qty));
    } else if (recipe.isError) { setItems([]); setYieldQty("1"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, recipe.data, recipe.isError]);

  const save = useMutation({
    mutationFn: () => upsertRecipe({ product_id: product!.id, yield_qty: Math.max(1, Number(yieldQty) || 1), items }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["recipe", product?.id] }),
    onError: onErr,
  });

  const ingName = (id: number) => ingredients.data?.find((i: Ingredient) => i.id === id)?.name ?? `#${id}`;
  const ingCost = (id: number) => Number(ingredients.data?.find((i: Ingredient) => i.id === id)?.cost_per_unit ?? 0);
  const batchCost = items.reduce((s, it) => s + (Number(it.quantity) || 0) * ingCost(it.ingredient_id), 0);
  const yieldN = Math.max(1, Number(yieldQty) || 1);
  const perUnit = batchCost / yieldN;
  const price = product ? Number(product.price) : null;

  const pickProduct = (p: Product) => { setProduct(p); setProductSearch(""); };

  return (
    <>
      {error && <ErrorText>{error}</ErrorText>}
      <Card>
        <Text style={styles.section}>Recipe builder</Text>
        {product ? (
          <View style={styles.row}>
            <Text style={styles.selectedProduct}>{product.name}</Text>
            <Button label="Change" tone="neutral" onPress={() => setProduct(null)} />
          </View>
        ) : (
          <View style={{ position: "relative", zIndex: 10 }}>
            <TextInput
              style={styles.input}
              placeholder='Search products… (e.g. "cro")'
              value={productSearch}
              onChangeText={setProductSearch}
              autoCorrect={false}
            />
            {productSearch.trim().length >= 2 && (
              <View style={styles.dropdown}>
                {(productResults.data ?? []).map((p: Product) => (
                  <Pressable key={p.id} style={styles.dropdownRow} onPress={() => pickProduct(p)}>
                    <Text style={styles.dropdownName}>{p.name}</Text>
                    <Text style={styles.dropdownPrice}>${p.price}</Text>
                  </Pressable>
                ))}
                {productResults.isSuccess && productResults.data.length === 0 && (
                  <Text style={styles.dropdownEmpty}>No matches</Text>
                )}
              </View>
            )}
          </View>
        )}

        {product && (
          <>
            {items.map((it, idx) => (
              <View key={idx} style={{ gap: spacing.xs }}>
                <View style={styles.pillsRow}>
                  {(ingredients.data ?? []).map((ing: Ingredient) => (
                    <Pressable
                      key={ing.id}
                      style={[styles.pill, it.ingredient_id === ing.id && styles.pillOn]}
                      onPress={() => setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, ingredient_id: ing.id } : x)))}
                    >
                      <Text style={it.ingredient_id === ing.id ? styles.pillTextOn : styles.pillText}>{ing.name}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.row}>
                  <TextInput
                    style={[styles.input, { maxWidth: 140 }]}
                    placeholder="Quantity"
                    keyboardType="decimal-pad"
                    value={it.quantity}
                    onChangeText={(t) => setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, quantity: t } : x)))}
                  />
                  <Text style={styles.meta}>of {ingName(it.ingredient_id)}</Text>
                  <Button label="Remove" tone="neutral" onPress={() => setItems((xs) => xs.filter((_, i) => i !== idx))} />
                </View>
              </View>
            ))}
            <View style={styles.row}>
              <Button
                label="+ Add ingredient"
                tone="neutral"
                disabled={!ingredients.data?.length}
                onPress={() => setItems((xs) => [...xs, { ingredient_id: ingredients.data![0].id, quantity: "1" }])}
              />
              <Button
                label="Save recipe"
                busy={save.isPending}
                disabled={items.length === 0 || items.some((i) => !/^\d+(\.\d+)?$/.test(i.quantity))}
                onPress={() => save.mutate()}
              />
              {save.isSuccess && <Text style={styles.saved}>Saved ✓</Text>}
            </View>

            <Text style={styles.fieldLabel}>Yield — units this recipe makes (e.g. 24 cupcakes)</Text>
            <TextInput style={[styles.input, { maxWidth: 140 }]} value={yieldQty} onChangeText={setYieldQty} keyboardType="number-pad" />

            <Card style={{ backgroundColor: colors.bg }}>
              <View style={styles.kvRow}><Text style={styles.meta}>Batch ingredient cost</Text><Text style={styles.kvValue}>${batchCost.toFixed(2)}</Text></View>
              <View style={styles.kvRow}><Text style={styles.meta}>Yield</Text><Text style={styles.kvValue}>{yieldN} unit{yieldN === 1 ? "" : "s"}</Text></View>
              <View style={styles.kvRow}><Text style={styles.name}>Cost per unit</Text><Text style={styles.kvValue}>${perUnit.toFixed(2)}</Text></View>
              {price != null && (
                <>
                  <View style={styles.kvRow}><Text style={styles.meta}>Sells for</Text><Text style={styles.kvValue}>${price.toFixed(2)}</Text></View>
                  <View style={styles.kvRow}>
                    <Text style={styles.name}>Margin per unit</Text>
                    <Text style={[styles.kvValue, { color: price - perUnit >= 0 ? colors.success : colors.danger }]}>${(price - perUnit).toFixed(2)}</Text>
                  </View>
                </>
              )}
              <Text style={styles.hint}>Based on current ingredient costs. Save to store the yield.</Text>
            </Card>
          </>
        )}
      </Card>
    </>
  );
}

function BusinessSection() {
  const client = useQueryClient();
  const { error, onErr } = useErr();
  const profile = useQuery({ queryKey: ["business"], queryFn: getBusinessProfile });
  const [form, setForm] = useState<BusinessProfile>({ business_name: "", business_address: "", business_phone: "" });

  useEffect(() => {
    if (profile.data) setForm(profile.data);
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () => updateBusinessProfile(form),
    onSuccess: () => client.invalidateQueries({ queryKey: ["business"] }),
    onError: onErr,
  });

  return (
    <Card>
      <Text style={styles.section}>Business profile</Text>
      <Text style={styles.hint}>Used as the header on receipts and the delivery manifest.</Text>
      {error && <ErrorText>{error}</ErrorText>}
      {profile.isLoading ? (
        <Loading />
      ) : (
        <>
          <Text style={styles.fieldLabel}>Bakery name</Text>
          <TextInput style={styles.input} value={form.business_name ?? ""} onChangeText={(t) => setForm((f) => ({ ...f, business_name: t }))} />
          <Text style={styles.fieldLabel}>Address</Text>
          <TextInput style={styles.input} value={form.business_address ?? ""} onChangeText={(t) => setForm((f) => ({ ...f, business_address: t }))} />
          <Text style={styles.fieldLabel}>Phone</Text>
          <TextInput style={styles.input} value={form.business_phone ?? ""} onChangeText={(t) => setForm((f) => ({ ...f, business_phone: t }))} />
          <View style={styles.row}>
            <Button label="Save" busy={save.isPending} onPress={() => save.mutate()} />
            {save.isSuccess && <Text style={styles.saved}>Saved ✓</Text>}
          </View>
        </>
      )}
    </Card>
  );
}

export default function SettingsScreen() {
  const { user } = useAuth();
  const [section, setSection] = useState<Section>("products");
  const isAdmin = user?.role === "admin";

  if (!isAdmin) {
    return <ErrorText>Settings requires Admin access.</ErrorText>;
  }

  return (
    <RequiresConnection>
      <View style={styles.screen}>
        <ScreenHeader
          title="Settings"
          right={
            <View style={styles.tabs}>
              {(["products", "ingredients", "recipes", "business"] as Section[]).map((s) => (
                <Pressable key={s} style={[styles.tab, section === s && styles.tabActive]} onPress={() => setSection(s)}>
                  <Text style={[styles.tabText, section === s && styles.tabTextActive]}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          }
        />
        <ScrollView contentContainerStyle={{ padding: spacing.l, gap: spacing.m }}>
          {section === "products" && <ProductsSection />}
          {section === "ingredients" && <IngredientsSection />}
          {section === "recipes" && <RecipesSection />}
          {section === "business" && <BusinessSection />}
        </ScrollView>
      </View>
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
  section: { fontSize: 15, fontWeight: "700", color: colors.text },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: spacing.s },
  row: { flexDirection: "row", gap: spacing.s, alignItems: "center", flexWrap: "wrap" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    backgroundColor: colors.bg,
    color: colors.text,
  },
  hint: { color: colors.textMuted, fontSize: 12 },
  name: { color: colors.text, fontWeight: "600" },
  meta: { color: colors.textMuted, fontSize: 12 },
  fieldLabel: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs },
  saved: { color: colors.success, fontWeight: "700" },
  pillsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.s },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.xs,
  },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { color: colors.text, fontSize: 13 },
  pillTextOn: { color: "#fff", fontWeight: "700", fontSize: 13 },
  photoCell: {
    width: 56,
    height: 56,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  photoImg: { width: 56, height: 56 },
  photoEmpty: { fontSize: 22 },
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
    zIndex: 20,
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
  selectedProduct: { color: colors.text, fontWeight: "700", fontSize: 15, flex: 1 },
  kvRow: { flexDirection: "row", justifyContent: "space-between" },
  kvValue: { color: colors.text, fontWeight: "700" },
});
