import { useEffect, useMemo, useState } from "react";

import { ApiError, getContact, listCategories, listProducts, submitInquiry, type PublicContact, type PublicProduct } from "./api";
import logo from "./logo.png";

function ProductCard({
  p, qty, onChange, onOpen,
}: {
  p: PublicProduct;
  qty: number;
  onChange: (qty: number) => void;
  onOpen: () => void;
}) {
  const extra = Math.max(0, p.photos.length - 1);
  return (
    // Highlighted once picked, so the grid itself shows the selection.
    <div className={`card${qty > 0 ? " card-selected" : ""}`}>
      {/* The picture is the way in: tapping it opens the product larger. The
          quantity buttons below stay where they were, so picking something
          off the grid still takes one tap. */}
      <button className="card-photo" onClick={onOpen} aria-label={`View ${p.name}`}>
        {p.photo_url
          ? <img src={p.photo_url} alt={p.name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          : <div className="photo-empty">🍰</div>}
        <span className="card-zoom">⤢</span>
        {extra > 0 && <span className="card-more">+{extra}</span>}
      </button>
      <div className="name">{p.name}</div>
      <div className="price">${p.price}</div>
      <div className="qty-row">
        <button className="qty-btn" onClick={() => onChange(Math.max(0, qty - 1))}>−</button>
        <span className="qty-val">{qty}</span>
        <button className="qty-btn" onClick={() => onChange(qty + 1)}>+</button>
      </div>
    </div>
  );
}

/** One product, opened up: the picture big enough to actually judge, and the
 * other angles if there are any.
 *
 * A grid thumbnail is roughly 170px on a phone, which is fine for finding a
 * cake and useless for deciding on one. Quantity lives in here too, so a
 * customer can look properly and then choose without closing it again.
 */
function ProductViewer({
  product, qty, onChange, onClose,
}: {
  product: PublicProduct;
  qty: number;
  onChange: (qty: number) => void;
  onClose: () => void;
}) {
  const photos = product.photos.length > 0
    ? product.photos
    : product.photo_url
      ? [product.photo_url]
      : [];
  const [index, setIndex] = useState(0);
  const current = photos[index];
  const step = (by: number) => setIndex((i) => (i + by + photos.length) % photos.length);

  // Escape closes, arrows move between photos — a viewer that traps you is
  // worse than no viewer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (photos.length > 1 && e.key === "ArrowRight") step(1);
      if (photos.length > 1 && e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="overlay" onClick={onClose}>
      <div className="viewer" onClick={(e) => e.stopPropagation()}>
        <button className="viewer-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="viewer-stage">
          {current ? (
            <img src={current} alt={product.name} />
          ) : (
            <div className="viewer-empty">🍰</div>
          )}
          {photos.length > 1 && (
            <>
              <button className="viewer-arrow left" onClick={() => step(-1)} aria-label="Previous photo">‹</button>
              <button className="viewer-arrow right" onClick={() => step(1)} aria-label="Next photo">›</button>
              <div className="viewer-count">{index + 1} / {photos.length}</div>
            </>
          )}
        </div>

        {photos.length > 1 && (
          <div className="viewer-thumbs">
            {photos.map((url, i) => (
              <button
                key={url}
                className={`viewer-thumb${i === index ? " is-active" : ""}`}
                onClick={() => setIndex(i)}
              >
                <img src={url} alt="" />
              </button>
            ))}
          </div>
        )}

        <div className="viewer-info">
          <div>
            <div className="viewer-name">{product.name}</div>
            <div className="viewer-price">${product.price}</div>
          </div>
          <div className="qty-row viewer-qty">
            <button className="qty-btn" onClick={() => onChange(Math.max(0, qty - 1))}>−</button>
            <span className="qty-val">{qty}</span>
            <button className="qty-btn" onClick={() => onChange(qty + 1)}>+</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckoutModal({
  products, cart, onClose, onSubmitted,
}: {
  products: PublicProduct[];
  cart: Record<number, number>;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lines = useMemo(
    () => Object.entries(cart)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ product: products.find((p) => p.id === Number(id))!, qty: q })),
    [cart, products],
  );

  const submit = async () => {
    setError(null);
    if (!name.trim() || !phone.trim()) {
      setError("Please enter your name and phone number.");
      return;
    }
    setBusy(true);
    try {
      await submitInquiry({
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        note: note.trim() || undefined,
        items: lines.map((l) => ({ product_id: l.product.id, quantity: l.qty })),
      });
      onSubmitted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong — please try again or call us directly.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Your selection</h2>
        <div className="summary">
          {lines.map((l) => (
            <div key={l.product.id}>{l.qty}× {l.product.name}</div>
          ))}
        </div>
        <input placeholder="Your name *" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Phone number *" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <textarea placeholder="Anything else we should know? (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          This saves your selection with us — please call us afterward to finalize and place your order.
        </p>
        <div className="modal-actions">
          <button className="btn btn-neutral" onClick={onClose}>Back</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "Saving…" : "Save my selection"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [products, setProducts] = useState<PublicProduct[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [contact, setContact] = useState<PublicContact | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    listProducts().then(setProducts).catch(() => setLoadError(true));
    listCategories().then(setCategories).catch(() => setCategories([]));
    getContact().then(setContact).catch(() => setContact(null));
  }, []);

  const totalItems = Object.values(cart).reduce((a, b) => a + b, 0);

  // Only show tabs for categories that actually have active products, so an
  // empty preset category never appears as a dead-end filter.
  const availableCategories = useMemo(
    () => categories.filter((c) => (products ?? []).some((p) => p.category === c)),
    [categories, products],
  );
  const visibleProducts = useMemo(
    () => (activeCategory ? (products ?? []).filter((p) => p.category === activeCategory) : products ?? []),
    [products, activeCategory],
  );

  if (submitted) {
    const phone = contact?.business_phone;
    return (
      <div className="page">
        <div className="confirmation">
          <div className="confirmation-badge">✓</div>
          <h2>You're all set — now call us!</h2>
          <p className="confirmation-sub">
            We've saved your selection. To finalize and place your order, please give us a call.
          </p>
          {phone ? (
            <a className="btn btn-primary confirmation-call" href={`tel:${phone.replace(/[^0-9+]/g, "")}`}>
              📞 Call {phone}
            </a>
          ) : (
            <p className="confirmation-sub">Please call the bakery to finish your order.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="site-header">
        <img src={logo} alt="Just Cake" className="site-logo" />
        <p>Pick what you'd like, save your selection, then call us to finalize your order.</p>
      </div>

      {availableCategories.length > 0 && (
        <div className="category-tabs">
          <button
            className={`tab${activeCategory === null ? " tab-active" : ""}`}
            onClick={() => setActiveCategory(null)}
          >
            All
          </button>
          {availableCategories.map((c) => (
            <button
              key={c}
              className={`tab${activeCategory === c ? " tab-active" : ""}`}
              onClick={() => setActiveCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {loadError ? (
        <p className="state-msg error">Couldn't load the menu — please try again shortly.</p>
      ) : !products ? (
        <p className="state-msg">Loading menu…</p>
      ) : visibleProducts.length === 0 ? (
        <p className="state-msg">No items in this category right now.</p>
      ) : (
        <div className="grid">
          {visibleProducts.map((p) => (
            <ProductCard
              key={p.id}
              p={p}
              qty={cart[p.id] ?? 0}
              onChange={(q) => setCart((c) => ({ ...c, [p.id]: q }))}
              onOpen={() => setViewing(p.id)}
            />
          ))}
        </div>
      )}

      {totalItems > 0 && (
        <div className="cart-bar">
          <div className="cart-bar-inner">
            <span className="cart-count">{totalItems} item{totalItems > 1 ? "s" : ""} selected</span>
            <button className="btn btn-primary" onClick={() => setCheckoutOpen(true)}>Continue</button>
          </div>
        </div>
      )}

      <div className="site-footer">
        {contact?.business_phone && (
          <a className="call" href={`tel:${contact.business_phone.replace(/[^0-9+]/g, "")}`}>
            📞 {contact.business_phone}
          </a>
        )}
        <p style={{ margin: 0 }}>
          Choose what you'd like above, then call to finalize — we'll take it from there.
        </p>
      </div>

      {viewing !== null && products && products.some((p) => p.id === viewing) && (
        <ProductViewer
          product={products.find((p) => p.id === viewing)!}
          qty={cart[viewing] ?? 0}
          onChange={(q) => setCart((c) => ({ ...c, [viewing]: q }))}
          onClose={() => setViewing(null)}
        />
      )}

      {checkoutOpen && products && (
        <CheckoutModal
          products={products}
          cart={cart}
          onClose={() => setCheckoutOpen(false)}
          onSubmitted={() => { setCheckoutOpen(false); setSubmitted(true); }}
        />
      )}
    </div>
  );
}
