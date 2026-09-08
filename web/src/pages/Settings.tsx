// Admin / Settings (§2I/§11): the catalog (products, ingredients, recipes) plus
// the business profile (receipt/manifest header). Admin-only — the backend
// returns 403 for others, which surfaces as an error message here.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ApiRequestError } from "../api/client";
import * as api from "../api/endpoints";
import type { Ingredient, Product } from "../api/types";
import { LoadFailed, Loading, PageHead, Tabs, isStalled } from "../components/ui";

type Section = "products" | "ingredients" | "recipes" | "business" | "tablet";

// Sentinel option value; no real category can collide with it because the
// backend strips and rejects blank names, and this isn't a plausible one.
const NEW_CATEGORY = "__new__";

/** Category dropdown that can also mint a new one. Picking "New category…"
 *  swaps the select for a free-text input, so staff never need a code change
 *  to add a category. */
function CategorySelect({
  value,
  onChange,
  placeholder = "Category…",
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const categories = useQuery({ queryKey: ["product-categories"], queryFn: api.listCategories });
  const [typing, setTyping] = useState(false);

  if (typing) {
    return (
      <span className="row" style={{ gap: 4 }}>
        <input
          className="input"
          autoFocus
          placeholder="New category name"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={style}
        />
        <button
          className="btn neutral sm"
          title="Pick from the list instead"
          onClick={() => { onChange(""); setTyping(false); }}
        >
          ✕
        </button>
      </span>
    );
  }

  // A just-typed category isn't in the server list until its product is saved,
  // so keep it selectable in the meantime.
  const known = categories.data ?? [];
  const options = value && !known.includes(value) ? [...known, value] : known;

  return (
    <select
      className="input"
      value={value}
      style={style}
      onChange={(e) => {
        if (e.target.value === NEW_CATEGORY) { onChange(""); setTyping(true); }
        else onChange(e.target.value);
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((c: string) => <option key={c} value={c}>{c}</option>)}
      <option value={NEW_CATEGORY}>＋ New category…</option>
    </select>
  );
}

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
            { key: "tablet", label: "Tablet app" },
          ]}
        />
      </PageHead>
      {section === "products" && <Products />}
      {section === "ingredients" && <Ingredients />}
      {section === "recipes" && <Recipes />}
      {section === "business" && <Business />}
      {section === "tablet" && <TabletApp />}
    </div>
  );
}

function useErr() {
  const [error, setError] = useState<string | null>(null);
  const onErr = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : "Action failed.");
  return { error, onErr };
}

function PhotoCell({
  p, onUpload, onManage, uploading,
}: {
  p: Product;
  onUpload: (p: Product, file: File) => void;
  onManage: (p: Product) => void;
  uploading: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="photo-cell">
        {/* Every photo, cover first. Clicking one opens the manager; the plus
            adds another. The cover is what the grid and the tablet show. */}
        {p.photos.map((ph, i) => (
          <button
            key={ph.id}
            className={`thumb-btn${i === 0 ? " thumb-cover" : ""}`}
            title={i === 0 ? "Cover photo — shown in the grid and on the tablet" : "Photo"}
            onClick={() => onManage(p)}
          >
            <img
              src={ph.url}
              alt={p.name}
              className="thumb"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          </button>
        ))}
        <button
          className="thumb-btn thumb-add"
          title={p.photos.length ? "Add another photo" : "Upload photo"}
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <span className="thumb thumb-empty">{uploading ? "…" : p.photos.length ? "＋" : "📷"}</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // allow re-selecting the same file next time
          if (file) onUpload(p, file);
        }}
      />
    </>
  );
}

function ProductRow({
  p, invalidate, onErr, onToggleActive, onToggleMenu, onDelete, onManagePhotos,
  onUploadPhoto, uploadingId,
}: {
  p: Product;
  invalidate: () => void;
  onErr: (e: unknown) => void;
  onToggleActive: (p: Product) => void;
  onToggleMenu: (p: Product) => void;
  onDelete: (p: Product) => void;
  onManagePhotos: (p: Product) => void;
  onUploadPhoto: (p: Product, file: File) => void;
  uploadingId: number | null;
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
        <td><PhotoCell p={p} onUpload={onUploadPhoto} onManage={onManagePhotos} uploading={uploadingId === p.id} /></td>
        <td><input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 140 }} /></td>
        <td>
          <CategorySelect value={category} onChange={setCategory} placeholder="—" style={{ maxWidth: 160 }} />
        </td>
        <td className="num"><input className="input" value={price} onChange={(e) => setPrice(e.target.value)} style={{ maxWidth: 90, textAlign: "right" }} /></td>
        <td className="muted" style={{ fontSize: 12 }}>{p.show_on_menu ? "Shown" : "Hidden"}</td>
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
      <td><PhotoCell p={p} onUpload={onUploadPhoto} onManage={onManagePhotos} uploading={uploadingId === p.id} /></td>
      <td>{p.name}</td>
      <td className="muted">{p.category ?? "—"}</td>
      <td className="num">${p.price}</td>
      <td>
        {/* Whether customers see it on justcakeskosher.com. Separate from
            Deactivate, which pulls the product out of the shop entirely —
            plenty of things are sold at the counter but not advertised. */}
        <label className="switch" title={p.show_on_menu ? "Shown on the website" : "Hidden from the website"}>
          <input
            type="checkbox"
            checked={p.show_on_menu}
            onChange={() => onToggleMenu(p)}
          />
          <span className="switch-track"><span className="switch-thumb" /></span>
          <span className="switch-label">{p.show_on_menu ? "Shown" : "Hidden"}</span>
        </label>
      </td>
      <td>
        <div className="row">
          <button className="btn neutral sm" onClick={start}>Edit</button>
          <button className="btn neutral sm" onClick={() => onToggleActive(p)}>{p.active ? "Deactivate" : "Activate"}</button>
          {/* Only ever succeeds for a product that was never sold — the server
              refuses the rest, because order history references it. */}
          <button className="btn neutral sm" onClick={() => onDelete(p)}>Delete</button>
        </div>
      </td>
    </tr>
  );
}

/** Manage one product's photos: set the cover, remove any of them.
 *
 * Adding happens from the row's ＋; this is the screen for deciding which shot
 * leads and dropping the ones that didn't come out.
 */
function PhotoManager({
  product, onClose, invalidate, onErr,
}: {
  product: Product;
  onClose: () => void;
  invalidate: () => void;
  onErr: (e: unknown) => void;
}) {
  const setCover = useMutation({
    mutationFn: (photoId: number) => api.setProductCover(product.id, photoId),
    onSuccess: invalidate,
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (photoId: number) => api.deleteProductPhoto(product.id, photoId),
    onSuccess: invalidate,
    onError: onErr,
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card" style={{ width: 520, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{product.name} — photos</h2>
        {product.photos.length === 0 ? (
          <p className="muted">No photos yet. Use ＋ on the row to add one.</p>
        ) : (
          <div className="photo-manager">
            {product.photos.map((ph, i) => (
              <div key={ph.id} className={`photo-manage-item${i === 0 ? " is-cover" : ""}`}>
                <img src={ph.url} alt="" />
                {i === 0 && <span className="photo-cover-flag">Cover</span>}
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  {i !== 0 && (
                    <button
                      className="btn neutral sm"
                      disabled={setCover.isPending}
                      onClick={() => setCover.mutate(ph.id)}
                    >
                      Make cover
                    </button>
                  )}
                  <button
                    className="btn neutral sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(ph.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="muted" style={{ fontSize: 13 }}>
          The cover is what staff see in the order screen and on the tablet. The rest show
          when a customer opens the product on the website.
        </p>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn neutral" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function Products() {
  const client = useQueryClient();
  const { error, onErr } = useErr();
  const products = useQuery({ queryKey: ["products"], queryFn: api.listProducts });
  // Saving a product may have introduced a category, so refresh that list too.
  const invalidate = () => {
    client.invalidateQueries({ queryKey: ["products"] });
    client.invalidateQueries({ queryKey: ["product-categories"] });
  };

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [managing, setManaging] = useState<number | null>(null);
  // Bumped after a save to remount CategorySelect, so a picker left in
  // "type a new category" mode returns to the dropdown — where the category
  // just created is now waiting.
  const [formKey, setFormKey] = useState(0);

  const create = useMutation({
    mutationFn: () => api.createProduct({ name: name.trim(), price: price.trim(), category: category.trim() || null }),
    onSuccess: () => {
      setName(""); setPrice(""); setCategory(""); setFormKey((k) => k + 1); invalidate();
    },
    onError: onErr,
  });
  const toggleActive = useMutation({
    mutationFn: (p: Product) => api.updateProduct(p.id, { active: !p.active }),
    onSuccess: invalidate,
    onError: onErr,
  });
  const removeProduct = useMutation({
    mutationFn: (p: Product) => api.deleteProduct(p.id),
    onSuccess: invalidate,
    onError: onErr,
  });
  const toggleMenu = useMutation({
    mutationFn: (p: Product) => api.updateProduct(p.id, { show_on_menu: !p.show_on_menu }),
    onSuccess: invalidate,
    onError: onErr,
  });
  const uploadPhoto = useMutation({
    mutationFn: (v: { p: Product; file: File }) => api.uploadProductPhoto(v.p.id, v.file),
    onMutate: (v) => setUploadingId(v.p.id),
    onSuccess: invalidate,
    onError: onErr,
    onSettled: () => setUploadingId(null),
  });

  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <h2>Add product</h2>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 2, minWidth: 200 }} />
          <input className="input" placeholder="Price (e.g. 3.50)" value={price} onChange={(e) => setPrice(e.target.value)} style={{ maxWidth: 140 }} />
          <CategorySelect key={formKey} value={category} onChange={setCategory} style={{ maxWidth: 180 }} />
          <button className="btn primary" disabled={!name.trim() || !/^\d+(\.\d{1,2})?$/.test(price.trim()) || create.isPending} onClick={() => create.mutate()}>
            Add
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Add the photo afterward — click the camera icon on its row below.</p>
      </div>
      <div className="card">
        <h2>Catalog</h2>
        {products.isLoading ? <Loading /> : products.isError ? <p className="error">Admin access required.</p> : (
          <table>
            <thead><tr><th>Photo</th><th>Name</th><th>Category</th><th className="num">Price</th><th>Website</th><th>Actions</th></tr></thead>
            <tbody>
              {(products.data ?? []).map((p) => (
                <ProductRow key={p.id} p={p} invalidate={invalidate} onErr={onErr}
                  onToggleActive={(x) => toggleActive.mutate(x)}
                  onToggleMenu={(x) => toggleMenu.mutate(x)}
                  onManagePhotos={(x) => setManaging(x.id)}
                  onDelete={(x) => {
                    // Confirm before, not after: the server's refusal for a
                    // sold product is informative, but deleting an unsold one
                    // is instant and there is no undo on this screen.
                    if (window.confirm(`Delete "${x.name}"? It can be put back from the Deleted page.`)) {
                      removeProduct.mutate(x);
                    }
                  }}
                  onUploadPhoto={(prod, file) => uploadPhoto.mutate({ p: prod, file })}
                  uploadingId={uploadingId}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Read from the live list, so the modal reflects each change without
          holding its own copy of the product. */}
      {managing !== null && (products.data ?? []).some((x) => x.id === managing) && (
        <PhotoManager
          product={(products.data ?? []).find((x) => x.id === managing)!}
          onClose={() => setManaging(null)}
          invalidate={invalidate}
          onErr={onErr}
        />
      )}
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
  const [yieldQty, setYieldQty] = useState("1");

  const recipe = useQuery({
    queryKey: ["recipe", productId],
    queryFn: () => api.getRecipe(Number(productId)),
    enabled: productId !== "",
    retry: false,
  });

  // Load existing recipe items + yield when a product is selected (or start empty).
  useEffect(() => {
    if (productId === "") { setItems([]); setYieldQty("1"); return; }
    if (recipe.data) {
      setItems(recipe.data.items.map((i) => ({ ingredient_id: i.ingredient_id, quantity: i.quantity })));
      setYieldQty(String(recipe.data.yield_qty));
    } else if (recipe.isError) { setItems([]); setYieldQty("1"); }
  }, [productId, recipe.data, recipe.isError]);

  const save = useMutation({
    mutationFn: () => api.upsertRecipe({ product_id: Number(productId), yield_qty: Math.max(1, Number(yieldQty) || 1), items }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["recipe", productId] }),
    onError: onErr,
  });

  const ingName = (id: number) => ingredients.data?.find((i) => i.id === id)?.name ?? `#${id}`;
  const ingCost = (id: number) => Number(ingredients.data?.find((i) => i.id === id)?.cost_per_unit ?? 0);
  const batchCost = items.reduce((s, it) => s + (Number(it.quantity) || 0) * ingCost(it.ingredient_id), 0);
  const yieldN = Math.max(1, Number(yieldQty) || 1);
  const perUnit = batchCost / yieldN;
  const product = products.data?.find((p) => p.id === Number(productId));
  const price = product ? Number(product.price) : null;

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

            {/* Yield + cost-per-unit calculator (spec §2C) */}
            <div className="field" style={{ maxWidth: 320, marginTop: 16 }}>
              <label>Yield — units this recipe makes (e.g. 24 cupcakes)</label>
              <input className="input" type="number" min={1} value={yieldQty}
                onChange={(e) => setYieldQty(e.target.value)} style={{ maxWidth: 140 }} />
            </div>
            <div className="card" style={{ background: "var(--bg)", maxWidth: 360 }}>
              <div className="row" style={{ justifyContent: "space-between" }}><span className="muted">Batch ingredient cost</span><strong>${batchCost.toFixed(2)}</strong></div>
              <div className="row" style={{ justifyContent: "space-between" }}><span className="muted">Yield</span><strong>{yieldN} unit{yieldN === 1 ? "" : "s"}</strong></div>
              <div className="row" style={{ justifyContent: "space-between" }}><span>Cost per unit</span><strong>${perUnit.toFixed(2)}</strong></div>
              {price != null && (
                <>
                  <div className="row" style={{ justifyContent: "space-between" }}><span className="muted">Sells for</span><strong>${price.toFixed(2)}</strong></div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span>Margin per unit</span>
                    <strong style={{ color: price - perUnit >= 0 ? "var(--success)" : "var(--danger)" }}>${(price - perUnit).toFixed(2)}</strong>
                  </div>
                </>
              )}
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Based on current ingredient costs. Save to store the yield.</p>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Where to get the tablet APK.
 *
 * Needed because an over-the-air update only reaches tablets whose installed
 * version matches the build it was published for. A tablet that was reset,
 * replaced, or simply left on an older binary can't be caught up by publishing
 * again — someone has to install the APK on it. Before this the download link
 * lived only in a build log.
 */
function TabletApp() {
  const build = useQuery({ queryKey: ["tablet-build"], queryFn: api.getTabletBuild });

  return (
    <div className="card">
      <h2>Tablet app</h2>
      {build.isLoading ? (
        <Loading />
      ) : isStalled(build) ? (
        <LoadFailed what="the tablet build" onRetry={() => void build.refetch()} />
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Install this on a tablet that is new, has been reset, or is running an older
            version. Everyday changes arrive on their own — a tablet only needs this when
            it is behind.
          </p>
          <div className="row" style={{ alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>Version {build.data!.version}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Build {build.data!.build} · {build.data!.built_on}
              </div>
            </div>
            <a
              className="btn primary"
              href={build.data!.url}
              target="_blank"
              rel="noreferrer noopener"
              style={{ marginLeft: "auto", textDecoration: "none" }}
            >
              ⬇ Download APK
            </a>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            Open this page on the tablet itself to download it there. Android will ask you to
            allow installing from the browser the first time.
          </p>
        </>
      )}
    </div>
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
