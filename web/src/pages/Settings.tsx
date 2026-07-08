// Admin / Settings (§2I/§11): the catalog (products, ingredients, recipes) plus
// the business profile (receipt/manifest header). Admin-only — the backend
// returns 403 for others, which surfaces as an error message here.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiRequestError } from "../api/client";
import * as api from "../api/endpoints";
import type { Ingredient, Product } from "../api/types";
import { Loading, PageHead, Tabs } from "../components/ui";

type Section = "products" | "ingredients" | "recipes" | "business";

export default function Settings() {
  const [section, setSection] = useState<Section>("products");
  return (
    <div className="page">
      <PageHead title="Admin / Settings">
        <Tabs
          value={section}
          onChange={setSection}
          options={[
            { key: "products", label: "Products" },
            { key: "ingredients", label: "Ingredients" },
            { key: "recipes", label: "Recipes" },
            { key: "business", label: "Business" },
          ]}
        />
      </PageHead>
      {section === "products" && <Products />}
      {section === "ingredients" && <Ingredients />}
      {section === "recipes" && <Recipes />}
      {section === "business" && <Business />}
    </div>
  );
}

function useErr() {
  const [error, setError] = useState<string | null>(null);
  const onErr = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : "Action failed.");
  return { error, onErr };
}

function PhotoCell({ p, onEditPhoto }: { p: Product; onEditPhoto: (p: Product) => void }) {
  return (
    <button className="thumb-btn" title="Set photo" onClick={() => onEditPhoto(p)}>
      {p.photo_url
        ? <img src={p.photo_url} alt={p.name} className="thumb" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        : <span className="thumb thumb-empty">📷</span>}
    </button>
  );
}

function ProductRow({
  p, invalidate, onErr, onToggleActive, onEditPhoto,
}: {
  p: Product;
  invalidate: () => void;
  onErr: (e: unknown) => void;
  onToggleActive: (p: Product) => void;
  onEditPhoto: (p: Product) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const [price, setPrice] = useState(p.price);
  const [category, setCategory] = useState(p.category ?? "");

  const save = useMutation({
    mutationFn: () => api.updateProduct(p.id, {
      name: name.trim(), price: price.trim(), category: category.trim() || null,
    }),
    onSuccess: () => { setEditing(false); invalidate(); },
    onError: onErr,
  });

  const start = () => {
    setName(p.name); setPrice(p.price); setCategory(p.category ?? ""); setEditing(true);
  };
  const validPrice = /^\d+(\.\d{1,2})?$/.test(price.trim());

  if (editing) {
    return (
      <tr>
        <td><PhotoCell p={p} onEditPhoto={onEditPhoto} /></td>
        <td><input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 140 }} /></td>
        <td><input className="input" placeholder="—" value={category} onChange={(e) => setCategory(e.target.value)} style={{ maxWidth: 140 }} /></td>
        <td className="num"><input className="input" value={price} onChange={(e) => setPrice(e.target.value)} style={{ maxWidth: 90, textAlign: "right" }} /></td>
        <td>
          <div className="row">
            <button className="btn primary sm" disabled={!name.trim() || !validPrice || save.isPending} onClick={() => save.mutate()}>Save</button>
            <button className="btn neutral sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr style={{ opacity: p.active ? 1 : 0.5 }}>
      <td><PhotoCell p={p} onEditPhoto={onEditPhoto} /></td>
      <td>{p.name}</td>
      <td className="muted">{p.category ?? "—"}</td>
      <td className="num">${p.price}</td>
      <td>
        <div className="row">
          <button className="btn neutral sm" onClick={start}>Edit</button>
          <button className="btn neutral sm" onClick={() => onToggleActive(p)}>{p.active ? "Deactivate" : "Activate"}</button>
        </div>
      </td>
    </tr>
  );
}

function Products() {
  const client = useQueryClient();
  const { error, onErr } = useErr();
  const products = useQuery({ queryKey: ["products"], queryFn: api.listProducts });
  const invalidate = () => client.invalidateQueries({ queryKey: ["products"] });

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  const create = useMutation({
    mutationFn: () => api.createProduct({ name: name.trim(), price: price.trim(), category: category.trim() || null, photo_url: photoUrl.trim() || null }),
    onSuccess: () => { setName(""); setPrice(""); setCategory(""); setPhotoUrl(""); invalidate(); },
    onError: onErr,
  });
  const toggleActive = useMutation({
    mutationFn: (p: Product) => api.updateProduct(p.id, { active: !p.active }),
    onSuccess: invalidate,
    onError: onErr,
  });
  const setPhoto = useMutation({
    mutationFn: (v: { id: number; photo_url: string | null }) => api.updateProduct(v.id, { photo_url: v.photo_url }),
    onSuccess: invalidate,
    onError: onErr,
  });
  const editPhoto = (p: Product) => {
    const next = window.prompt(`Photo URL for "${p.name}" (blank to remove):`, p.photo_url ?? "");
    if (next === null) return; // cancelled
    setPhoto.mutate({ id: p.id, photo_url: next.trim() || null });
  };

  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <h2>Add product</h2>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 2, minWidth: 200 }} />
          <input className="input" placeholder="Price (e.g. 3.50)" value={price} onChange={(e) => setPrice(e.target.value)} style={{ maxWidth: 140 }} />
          <input className="input" placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} style={{ maxWidth: 180 }} />
          <input className="input" placeholder="Photo URL (optional)" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn primary" disabled={!name.trim() || !/^\d+(\.\d{1,2})?$/.test(price.trim()) || create.isPending} onClick={() => create.mutate()}>
            Add
          </button>
        </div>
      </div>
      <div className="card">
        <h2>Catalog</h2>
        {products.isLoading ? <Loading /> : products.isError ? <p className="error">Admin access required.</p> : (
          <table>
            <thead><tr><th>Photo</th><th>Name</th><th>Category</th><th className="num">Price</th><th>Actions</th></tr></thead>
            <tbody>
              {(products.data ?? []).map((p) => (
                <ProductRow key={p.id} p={p} invalidate={invalidate} onErr={onErr}
                  onToggleActive={(x) => toggleActive.mutate(x)} onEditPhoto={editPhoto} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Ingredients() {
  const client = useQueryClient();
  const { error, onErr } = useErr();
  const ingredients = useQuery({ queryKey: ["ingredients"], queryFn: () => api.listIngredients() });
  const invalidate = () => client.invalidateQueries({ queryKey: ["ingredients"] });

  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const [cost, setCost] = useState("");
  const [threshold, setThreshold] = useState("0");

  const create = useMutation({
    mutationFn: () => api.createIngredient({ name: name.trim(), unit: unit.trim(), cost_per_unit: cost.trim(), low_stock_threshold: threshold.trim() || "0" }),
    onSuccess: () => { setName(""); setCost(""); setThreshold("0"); invalidate(); },
    onError: onErr,
  });
  const toggleActive = useMutation({
    mutationFn: (i: Ingredient) => api.updateIngredient(i.id, { active: !i.active }),
    onSuccess: invalidate,
    onError: onErr,
  });

  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <h2>Add ingredient</h2>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 2, minWidth: 180 }} />
          <input className="input" placeholder="Unit (kg/g/unit)" value={unit} onChange={(e) => setUnit(e.target.value)} style={{ maxWidth: 120 }} />
          <input className="input" placeholder="Cost / unit" value={cost} onChange={(e) => setCost(e.target.value)} style={{ maxWidth: 120 }} />
          <input className="input" placeholder="Low threshold" value={threshold} onChange={(e) => setThreshold(e.target.value)} style={{ maxWidth: 120 }} />
          <button className="btn primary" disabled={!name.trim() || !/^\d+(\.\d+)?$/.test(cost.trim()) || create.isPending} onClick={() => create.mutate()}>
            Add
          </button>
        </div>
      </div>
      <div className="card">
        <h2>Ingredients</h2>
        {ingredients.isLoading ? <Loading /> : ingredients.isError ? <p className="error">Admin access required.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Unit</th><th className="num">Cost/unit</th><th className="num">Low threshold</th><th>Active</th></tr></thead>
            <tbody>
              {(ingredients.data ?? []).map((i: Ingredient) => (
                <tr key={i.id} style={{ opacity: i.active ? 1 : 0.5 }}>
                  <td>{i.name}</td><td>{i.unit}</td>
                  <td className="num">${i.cost_per_unit}</td>
                  <td className="num">{i.low_stock_threshold}</td>
                  <td><button className="btn neutral sm" onClick={() => toggleActive.mutate(i)}>{i.active ? "Deactivate" : "Activate"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Recipes() {
  const client = useQueryClient();
  const { error, onErr } = useErr();
  const products = useQuery({ queryKey: ["products"], queryFn: api.listProducts });
  const ingredients = useQuery({ queryKey: ["ingredients"], queryFn: () => api.listIngredients() });
  const [productId, setProductId] = useState<number | "">("");
  const [items, setItems] = useState<{ ingredient_id: number; quantity: string }[]>([]);

  const recipe = useQuery({
    queryKey: ["recipe", productId],
    queryFn: () => api.getRecipe(Number(productId)),
    enabled: productId !== "",
    retry: false,
  });

  // Load existing recipe items when a product is selected (or start empty).
  useEffect(() => {
    if (productId === "") return setItems([]);
    if (recipe.data) setItems(recipe.data.items.map((i) => ({ ingredient_id: i.ingredient_id, quantity: i.quantity })));
    else if (recipe.isError) setItems([]);
  }, [productId, recipe.data, recipe.isError]);

  const save = useMutation({
    mutationFn: () => api.upsertRecipe({ product_id: Number(productId), items }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["recipe", productId] }),
    onError: onErr,
  });

  const ingName = (id: number) => ingredients.data?.find((i) => i.id === id)?.name ?? `#${id}`;

  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <h2>Recipe builder</h2>
        <div className="field" style={{ maxWidth: 320 }}>
          <label>Product</label>
          <select className="input" value={productId} onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Select a product…</option>
            {(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {productId !== "" && (
          <>
            {items.map((it, idx) => (
              <div key={idx} className="row" style={{ marginBottom: 8 }}>
                <select
                  className="input"
                  value={it.ingredient_id}
                  onChange={(e) => setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, ingredient_id: Number(e.target.value) } : x)))}
                  style={{ maxWidth: 260 }}
                >
                  {(ingredients.data ?? []).map((ing) => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
                </select>
                <input
                  className="input"
                  placeholder="Quantity"
                  value={it.quantity}
                  onChange={(e) => setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))}
                  style={{ maxWidth: 140 }}
                />
                <span className="muted">of {ingName(it.ingredient_id)}</span>
                <button className="btn neutral sm" onClick={() => setItems((xs) => xs.filter((_, i) => i !== idx))}>Remove</button>
              </div>
            ))}
            <div className="row">
              <button
                className="btn neutral"
                disabled={!ingredients.data?.length}
                onClick={() => setItems((xs) => [...xs, { ingredient_id: ingredients.data![0].id, quantity: "1" }])}
              >
                + Add ingredient
              </button>
              <button
                className="btn primary"
                disabled={items.length === 0 || items.some((i) => !/^\d+(\.\d+)?$/.test(i.quantity)) || save.isPending}
                onClick={() => save.mutate()}
              >
                Save recipe
              </button>
              {save.isSuccess && <span className="tone-ok">Saved ✓</span>}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Business() {
  const client = useQueryClient();
  const { error, onErr } = useErr();
  const profile = useQuery({ queryKey: ["business"], queryFn: api.getBusinessProfile });
  const [form, setForm] = useState({ business_name: "", business_address: "", business_phone: "" });

  useEffect(() => {
    if (profile.data)
      setForm({
        business_name: profile.data.business_name ?? "",
        business_address: profile.data.business_address ?? "",
        business_phone: profile.data.business_phone ?? "",
      });
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () => api.updateBusinessProfile(form),
    onSuccess: () => client.invalidateQueries({ queryKey: ["business"] }),
    onError: onErr,
  });

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <h2>Business profile</h2>
      <p className="muted" style={{ fontSize: 12 }}>Used as the header on receipts and the delivery manifest.</p>
      {error && <p className="error">{error}</p>}
      {profile.isLoading ? <Loading /> : (
        <>
          <div className="field"><label>Bakery name</label><input className="input" value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} /></div>
          <div className="field"><label>Address</label><input className="input" value={form.business_address} onChange={(e) => setForm({ ...form, business_address: e.target.value })} /></div>
          <div className="field"><label>Phone</label><input className="input" value={form.business_phone} onChange={(e) => setForm({ ...form, business_phone: e.target.value })} /></div>
          <button className="btn primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
          {save.isSuccess && <span className="tone-ok" style={{ marginLeft: 12 }}>Saved ✓</span>}
        </>
      )}
    </div>
  );
}
