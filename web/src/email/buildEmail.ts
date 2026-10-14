// Builds the product email as HTML you can paste straight into Gmail.
//
// Three constraints shape every decision here:
//
// 1. **Gmail strips <style> blocks** — including on paste into its composer.
//    Every rule is an inline `style=` attribute, and there are no media
//    queries. A stylesheet would look right in the preview and then arrive
//    naked in the customer's inbox.
// 2. **The layout has to adapt without media queries.** Most of these are
//    read on a tablet or a phone. The product cards are inline-blocks with a
//    max-width (the "fluid hybrid" pattern): two sit side by side when there
//    is room, and they stack into one column when there isn't. A two-column
//    table can't do that — it just squeezes.
// 3. **Structure is tables.** Flexbox and grid are unreliable across mail
//    clients; tables and inline-blocks are what have always worked.
//
// Images are absolute URLs to the product photos already in object storage, so
// they load wherever the mail ends up — no attachments, nothing to embed.

import type { Product } from "../api/types";

export interface EmailParts {
  subject: string;
  intro: string;
  signoff: string;
  products: Product[];
  logoUrl: string;
  shopName: string;
  phone?: string | null;
  address?: string | null;
  /** The public ordering site; shown as the "Order online" button. */
  websiteUrl?: string | null;
}

/** Escapes text going into the HTML. Names and notes are shop-typed, but this
 *  is markup being handed to a mail client, so it gets escaped like any other
 *  untrusted interpolation. */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A tel: target from however the number was typed: "(514) 555-0100 ext 2"
 *  dials as +5145550100. Empty when there are no digits to dial. */
export function telHref(phone: string): string {
  const main = phone.split(/ext|x|#/i)[0];
  const digits = main.replace(/[^\d+]/g, "");
  return /\d{7,}/.test(digits) ? `tel:${digits}` : "";
}

/** Only http(s) links go into the email — anything else typed into a setting
 *  is dropped rather than turned into a clickable link. */
function safeUrl(url: string | null | undefined): string {
  const u = (url ?? "").trim();
  return /^https?:\/\/[^\s"<>]+$/i.test(u) ? u : "";
}

/** "https://justcakeskosher.com/" → "justcakeskosher.com" for display. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/** Turns typed line breaks into paragraphs — people write emails with returns
 *  in them and expect those to survive. */
function paragraphs(text: string, style: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="${style}">${esc(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Products grouped by category, in the order they were picked. Products with
 *  no category go in a group of their own, last. */
export function groupByCategory(products: Product[]): { category: string | null; products: Product[] }[] {
  const groups = new Map<string | null, Product[]>();
  for (const p of products) {
    const key = p.category?.trim() || null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const named = [...groups.entries()].filter(([k]) => k !== null);
  const unnamed = groups.get(null);
  return [
    ...named.map(([category, ps]) => ({ category, products: ps })),
    ...(unnamed ? [{ category: null, products: unnamed }] : []),
  ];
}

const BRAND = "#b5622a";
const BRAND_DARK = "#8a441a";
const TEXT = "#2a2018";
const MUTED = "#7d675a";
const BORDER = "#ecdfd2";
const CREAM = "#fdf7f0";
const BLUSH = "#fbf0e5";

// Container 640 wide with 16px side padding leaves 608 for the cards: two of
// 288 plus 8px margin either side. On anything narrower they stack, each
// taking the full width up to that 288 cap — wide enough to read on a phone.
const CONTAINER = 640;
const CARD = 288;

const serif = `font-family: Georgia, 'Times New Roman', serif; color: ${TEXT};`;
const sans = "font-family: Arial, Helvetica, sans-serif;";

function card(p: Product): string {
  const photo = p.photo_url
    ? `<img src="${esc(p.photo_url)}" width="${CARD}" alt="${esc(p.name)}"
            style="display: block; width: 100%; max-width: ${CARD}px; height: auto;
                   border: 0; border-radius: 14px 14px 0 0;">`
    : `<div style="padding: 54px 0; text-align: center; font-size: 40px; line-height: 1;
                   background: ${BLUSH}; color: ${BRAND}; border-radius: 14px 14px 0 0;">&#127856;</div>`;

  return `<div style="display: inline-block; width: 100%; max-width: ${CARD}px;
                      vertical-align: top; margin: 8px; text-align: left;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"
         style="background: #ffffff; border: 1px solid ${BORDER}; border-radius: 16px;">
    <tr><td style="padding: 0; line-height: 0; font-size: 0;">${photo}</td></tr>
    <tr>
      <td style="padding: 16px 18px 18px;">
        <div style="${serif} font-size: 20px; font-weight: bold; line-height: 1.3;">${esc(p.name)}</div>
        <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top: 10px;">
          <tr>
            <td style="${sans} font-size: 16px; font-weight: bold; color: #ffffff;
                       background: ${BRAND}; padding: 6px 14px; border-radius: 999px;">$${esc(p.price)}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;
}

/** A button that survives every mail client: the colour is on a table cell,
 *  and the whole padded cell is the link, so it's an easy target on a
 *  touchscreen. */
function button(href: string, label: string, filled: boolean): string {
  const bg = filled ? BRAND : "#ffffff";
  const fg = filled ? "#ffffff" : BRAND_DARK;
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation"
       style="display: inline-table; margin: 6px;">
  <tr>
    <td style="background: ${bg}; border: 2px solid ${BRAND}; border-radius: 999px;">
      <a href="${esc(href)}" style="${sans} display: inline-block; padding: 14px 30px;
         font-size: 17px; font-weight: bold; color: ${fg}; text-decoration: none;">${esc(label)}</a>
    </td>
  </tr>
</table>`;
}

export function buildEmailHtml(parts: EmailParts): string {
  const { intro, signoff, products, logoUrl, shopName, phone, address } = parts;
  const tel = phone ? telHref(phone) : "";
  const website = safeUrl(parts.websiteUrl);
  const para = `${serif} font-size: 18px; line-height: 1.65; margin: 0 0 16px;`;

  // Headings only help when there's more than one kind of thing in the email.
  const groups = groupByCategory(products);
  const showHeadings = groups.length > 1;
  const grid = groups
    .map(
      (g) => `${showHeadings
        ? `<div style="${sans} font-size: 13px; font-weight: bold; letter-spacing: 2px;
                      text-transform: uppercase; color: ${BRAND_DARK};
                      padding: 20px 8px 2px; text-align: center;">${esc(g.category ?? "More")}</div>`
        : ""}${g.products.map(card).join("")}`,
    )
    .join("");

  const buttons = [
    tel ? button(tel, "Call to order", true) : "",
    website ? button(website, "Order online", !tel) : "",
  ].join("");

  const footerLines = [
    address?.trim() ? esc(address.trim()).replace(/\n/g, "<br>") : "",
    phone?.trim()
      ? tel
        ? `<a href="${esc(tel)}" style="color: ${MUTED}; text-decoration: none;">${esc(phone.trim())}</a>`
        : esc(phone.trim())
      : "",
    website
      ? `<a href="${esc(website)}" style="color: ${BRAND_DARK}; text-decoration: none;">${esc(displayUrl(website))}</a>`
      : "",
  ].filter(Boolean);

  return `<table cellpadding="0" cellspacing="0" border="0" width="100%" role="presentation"
       style="background: ${CREAM}; margin: 0;">
  <tr><td align="center" style="padding: 24px 10px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" role="presentation"
           style="width: 100%; max-width: ${CONTAINER}px; background: #ffffff;
                  border: 1px solid ${BORDER}; border-radius: 20px;">

      <tr>
        <td style="background: ${BRAND}; height: 6px; line-height: 6px; font-size: 0;
                   border-radius: 20px 20px 0 0;">&nbsp;</td>
      </tr>

      <tr>
        <td align="center" style="padding: 32px 24px 6px;">
          <img src="${esc(logoUrl)}" alt="${esc(shopName)}" width="210"
               style="display: block; width: 210px; max-width: 70%; height: auto; border: 0;">
        </td>
      </tr>
      <tr>
        <td align="center" style="padding: 14px 24px 0;">
          <table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr>
            <td style="border-top: 2px solid ${BRAND}; width: 60px; line-height: 0;
                       font-size: 0;">&nbsp;</td>
          </tr></table>
        </td>
      </tr>

      ${intro.trim()
        ? `<tr><td style="padding: 24px 32px 4px;">${paragraphs(intro, para)}</td></tr>`
        : ""}

      <tr>
        <td align="center" style="padding: 4px 8px 0; font-size: 0; text-align: center;">${grid}</td>
      </tr>

      ${signoff.trim()
        ? `<tr><td style="padding: 24px 32px 4px;">${paragraphs(signoff, para)}</td></tr>`
        : ""}

      ${buttons
        ? `<tr><td align="center" style="padding: 12px 16px 28px; font-size: 0;">${buttons}</td></tr>`
        : ""}

      <tr>
        <td align="center" style="background: ${CREAM}; padding: 24px 24px 26px;
                                  border-top: 1px solid ${BORDER}; border-radius: 0 0 20px 20px;">
          <div style="${serif} font-size: 21px; color: ${BRAND_DARK}; font-weight: bold;">
            ${esc(shopName)}
          </div>
          ${footerLines.length
            ? `<div style="${sans} font-size: 15px; line-height: 1.7; color: ${MUTED}; padding-top: 6px;">
                 ${footerLines.join("<br>")}
               </div>`
            : ""}
        </td>
      </tr>
    </table>
  </td></tr>
</table>`;
}

/** The same email as plain text — the fallback half of the clipboard write, and
 *  what a text-only mail client shows. */
export function buildEmailText(parts: EmailParts): string {
  const lines: string[] = [];
  if (parts.intro.trim()) lines.push(parts.intro.trim(), "");
  const groups = groupByCategory(parts.products);
  groups.forEach((g, i) => {
    if (groups.length > 1) {
      if (i > 0) lines.push("");
      lines.push((g.category ?? "More").toUpperCase());
    }
    for (const p of g.products) lines.push(`• ${p.name} — $${p.price}`);
  });
  if (parts.signoff.trim()) lines.push("", parts.signoff.trim());
  lines.push("", parts.shopName);
  if (parts.address?.trim()) lines.push(parts.address.trim());
  if (parts.phone) lines.push(parts.phone);
  const website = safeUrl(parts.websiteUrl);
  if (website) lines.push(`Order online: ${website}`);
  return lines.join("\n");
}
