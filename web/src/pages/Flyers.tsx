// Flyers — one per category, built live from the website's product list.
//
// Nothing here is stored: every time the page opens it reads the same feed the
// website does, so a new price, a new photo, or a product switched off for the
// website is on (or off) the flyer the next time anyone prints it.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import * as api from "../api/endpoints";
import type { PublicProduct } from "../api/types";
import { LoadFailed, Loading, PageHead, isStalled } from "../components/ui";
import { flyerCategories, flyerPages, flyerPrice } from "../flyer/flyer";

const WEBSITE = "justcakeskosher.com";

export default function Flyers() {
  const products = useQuery({
    queryKey: ["public-products"],
    queryFn: api.listPublicProducts,
    // Always re-read on open: the point is that the flyer is never stale.
    refetchOnMount: "always",
  });
  const profile = useQuery({ queryKey: ["business"], queryFn: api.getBusinessProfile });
  const [chosen, setChosen] = useState<string | null>(null);

  const categories = flyerCategories(products.data ?? []);
  const category = categories.some((c) => c.category === chosen) ? chosen! : categories[0]?.category ?? null;
  const pages = category ? flyerPages(products.data ?? [], category) : [];
  const today = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="page flyers-root">
      <div className="no-print">
        <PageHead title="Flyers">
          {category && (
            <button className="btn primary" onClick={() => window.print()}>Print / Save as PDF</button>
          )}
        </PageHead>
        <p className="muted" style={{ marginTop: -6 }}>
          One flyer per category, made from the products switched on for the website. Change a
          price, photo or switch and the flyer follows — just open it again.
        </p>
      </div>

      {products.isLoading ? (
        <Loading />
      ) : isStalled(products) ? (
        <LoadFailed what="the products" onRetry={() => void products.refetch()} />
      ) : categories.length === 0 ? (
        <div className="card">
          <p className="muted">
            Nothing is switched on for the website yet, so there's nothing to put on a flyer. Turn
            products on in Admin / Settings → Products (the Website switch).
          </p>
        </div>
      ) : (
        <>
          <div className="flyer-tabs no-print">
            {categories.map((c) => (
              <button
                key={c.category}
                className={`tab${c.category === category ? " active" : ""}`}
                onClick={() => setChosen(c.category)}
              >
                {c.category} <span className="muted">({c.count})</span>
              </button>
            ))}
          </div>

          <div className="flyer-stack">
            {pages.map((items, i) => (
              <FlyerPage
                key={`${category}-${i}`}
                category={category!}
                items={items}
                page={i + 1}
                pages={pages.length}
                phone={profile.data?.business_phone ?? null}
                address={profile.data?.business_address ?? null}
                date={today}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FlyerPage({
  category, items, page, pages, phone, address, date,
}: {
  category: string;
  items: PublicProduct[];
  page: number;
  pages: number;
  phone: string | null;
  address: string | null;
  date: string;
}) {
  return (
    <section className="flyer-page" aria-label={`${category} flyer, page ${page}`}>
      <div className="flyer-band" />
      <div className="flyer-body">
      <header className="flyer-head">
        <img src="/logo.png" alt="Just Cake" className="flyer-logo" />
        <h1 className="flyer-title">{category}</h1>
        <div className="flyer-rule" />
        {pages > 1 && <div className="flyer-pageno">Page {page} of {pages}</div>}
      </header>

      <div className={`flyer-grid n${Math.min(items.length, 3)}`}>
        {items.map((p) => (
          <div key={p.id} className="flyer-item">
            {p.photo_url ? (
              <img src={p.photo_url} alt={p.name} className="flyer-photo" />
            ) : (
              <div className="flyer-photo flyer-nophoto">🍰</div>
            )}
            <div className="flyer-name">{p.name}</div>
            <div className="flyer-price">{flyerPrice(p.price)}</div>
          </div>
        ))}
      </div>

      <footer className="flyer-foot">
        <div className="flyer-contact">
          {phone && <span>{phone}</span>}
          {address && <span>{address}</span>}
          <span>{WEBSITE}</span>
        </div>
        <div className="flyer-date">Prices as of {date}</div>
      </footer>
      </div>
    </section>
  );
}
