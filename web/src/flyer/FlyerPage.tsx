// One printed flyer sheet. Shared by the dashboard's Flyers page and the easy
// app's brochure, with the styles in flyer.css.

import type { PublicProduct } from "../api/types";
import { WEBSITE, flyerPrice } from "./flyer";
import "./flyer.css";

export default function FlyerPage({
  category, items, page, pages, phone, address, date, dense = false,
}: {
  category: string;
  items: PublicProduct[];
  page: number;
  pages: number;
  phone: string | null;
  address: string | null;
  date: string;
  /** Twelve to a page (the easy app's brochure) rather than nine. */
  dense?: boolean;
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

      <div className={`flyer-grid ${dense ? "dense" : `n${Math.min(items.length, 3)}`}`}>
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
