// Shared building blocks for taking or editing an order's info + items. Used
// by both New Order (create) and Order Detail's edit mode (update) so the two
// flows can't quietly drift apart from each other.

import { useQuery } from "@tanstack/react-query";
import { useState, type Dispatch, type SetStateAction } from "react";

import { listCategories, listProductsByCategory, searchProducts } from "../api/endpoints";
import type { Product } from "../api/types";
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
  const nd = draft.neededFor ? draft.neededFor.split("T")[0] : "";
  const nt = draft.neededFor?.includes("T") ? draft.neededFor.split("T")[1].slice(0, 5) : "";
  return (
    <div className="card">
      <div className="row" style={{ flexWrap: "wrap" }}>
        <input className="input" style={{ flex: 2, minWidth: 200 }} placeholder="Client name *"
          value={draft.clientName} onChange={(e) => set({ clientName: e.target.value })} />
        <input className="input" style={{ maxWidth: 160 }} placeholder="Phone"
          value={draft.clientPhone} onChange={(e) => set({ clientPhone: e.target.value })} />
        <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="muted" style={{ fontSize: 11 }}>Needed for (date)</span>
          <input className="input" type="date" style={{ maxWidth: 160 }} value={nd}
            onChange={(e) => set({ neededFor: e.target.value ? (nt ? `${e.target.value}T${nt}` : e.target.value) : null })} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="muted" style={{ fontSize: 11 }}>Time (optional)</span>
          <input className="input" type="time" style={{ maxWidth: 130 }} value={nt} disabled={!nd}
            title={!nd ? "Pick a date first" : ""}
            onChange={(e) => set({ neededFor: nd ? (e.target.value ? `${nd}T${e.target.value}` : nd) : null })} />
        </label>
      </div>
      <div className="row" style={{ flexWrap: "wrap", marginTop: 12 }}>
        <div className="tabs">
          {(["pickup", "delivery"] as const).map((f) => (
            <button key={f} className={`tab${draft.fulfillment === f ? " active" : ""}`} onClick={() => set({ fulfillment: f })}>
              {f === "pickup" ? "Pickup" : "Delivery"}
            </button>
          ))}
        </div>
        {draft.fulfillment === "delivery" && (
          <>
            <input className="input" style={{ maxWidth: 180 }} placeholder="Delivery name (recipient)"
              value={draft.deliveryName} onChange={(e) => set({ deliveryName: e.target.value })} />
            <input className="input" style={{ maxWidth: 130 }} placeholder="Delivery $"
              value={draft.deliveryPrice} onChange={(e) => set({ deliveryPrice: e.target.value })} />
            <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Delivery address *"
              value={draft.deliveryAddress} onChange={(e) => set({ deliveryAddress: e.target.value })} />
          </>
        )}
      </div>
      <input className="input" style={{ marginTop: 12 }} placeholder="Card message"
        value={draft.cardMessage} onChange={(e) => set({ cardMessage: e.target.value })} />
    </div>
  );
}

export function OrderItemsEditor({ draft, setDraft }: { draft: Draft; setDraft: Dispatch<SetStateAction<Draft>> }) {
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
  // Category buttons: browsing an alternative to searching. Only the open
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

  const pick = (p: Product) => {
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
    <div className="card">
      <div style={{ position: "relative" }}>
        <input className="input" placeholder='Search products… (e.g. "cro")' value={search}
          onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
        {search.trim().length >= 2 && (
          <div className="dropdown">
            {(results.data ?? []).map((p) => (
              <button key={p.id} className="dropdown-row" onClick={() => pick(p)}>
                <span style={{ display: "flex", alignItems: "center" }}>
                  {p.photo_url
                    ? <img src={p.photo_url} alt="" className="thumb" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                    : <span className="thumb thumb-empty">📷</span>}
                  {p.name}
                </span>
                <span className="muted">${p.price}</span>
              </button>
            ))}
            {results.isSuccess && results.data.length === 0 && <div style={{ padding: 10 }} className="muted">No matches</div>}
          </div>
        )}
      </div>

      {/* Browse by category — tap to open a grid, tap again to close. */}
      {(categories.data ?? []).length > 0 && (
        <div className="category-row">
          {(categories.data ?? []).map((c: string) => (
            <button
              key={c}
              className={`btn sm ${openCategory === c ? "primary" : "neutral"}`}
              aria-pressed={openCategory === c}
              onClick={() => setOpenCategory((cur) => (cur === c ? null : c))}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {openCategory !== null && (
        categoryProducts.isPending ? (
          <p className="muted" style={{ textAlign: "center" }}>Loading {openCategory}…</p>
        ) : (categoryProducts.data ?? []).length === 0 ? (
          <p className="muted" style={{ textAlign: "center" }}>Nothing in {openCategory} yet.</p>
        ) : (
          <div className="product-grid">
            {(categoryProducts.data ?? []).map((p: Product) => (
              <button key={p.id} className="product-chip" onClick={() => pick(p)}>
                <span className="product-chip-name">{p.name}</span>
                <span className="muted">${p.price}</span>
              </button>
            ))}
          </div>
        )
      )}

      {!customOpen ? (
        <button className="btn neutral sm" style={{ marginTop: 8 }} onClick={() => setCustomOpen(true)}>
          + Custom item
        </button>
      ) : (
        <div className="row" style={{ flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
          <input className="input" placeholder="Item name" value={customName}
            onChange={(e) => setCustomName(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <input className="input" placeholder="Price" value={customPrice}
            onChange={(e) => setCustomPrice(e.target.value)} style={{ maxWidth: 100 }} />
          <label className="row" style={{ gap: 6, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={customSave} onChange={(e) => setCustomSave(e.target.checked)} />
            Save as a regular product
          </label>
          <button className="btn primary sm" disabled={!customName.trim() || !customPriceValid} onClick={addCustom}>
            Add
          </button>
          <button className="btn neutral sm" onClick={() => { setCustomOpen(false); setCustomName(""); setCustomPrice(""); setCustomSave(false); }}>
            Cancel
          </button>
        </div>
      )}

      {draft.lines.length === 0 ? (
        <p className="muted" style={{ textAlign: "center" }}>No items yet — search or pick a category above.</p>
      ) : (
        draft.lines.map((l, i) => (
          <div key={`${l.product_id}-${i}`} className="row" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {l.product_name}
                {l.product_id === null && <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}> · custom{l.saveAsProduct ? ", saved" : ""}</span>}
              </div>
              <input className="input" style={{ marginTop: 4, padding: "4px 8px" }} placeholder="Note for this item…"
                value={l.note} onChange={(e) => setDraft((d) => setLineNote(d, i, e.target.value))} />
            </div>
            <div className="row">
              <button className="btn neutral sm" onClick={() => setDraft((d) => setQuantity(d, i, l.quantity - 1))}>−</button>
              <input className="input" style={{ width: 52, textAlign: "center" }} value={l.quantity}
                onChange={(e) => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) setDraft((d) => setQuantity(d, i, n)); }} />
              <button className="btn neutral sm" onClick={() => setDraft((d) => setQuantity(d, i, l.quantity + 1))}>+</button>
            </div>
            <div style={{ width: 70, textAlign: "right", fontWeight: 700 }}>${lineTotal(l)}</div>
            <button className="btn neutral sm" onClick={() => setDraft((d) => removeLine(d, i))}>✕</button>
          </div>
        ))
      )}
    </div>
  );
}
