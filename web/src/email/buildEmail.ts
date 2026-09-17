// Builds the product email as HTML you can paste straight into Gmail.
//
// Two constraints shape every decision here:
//
// 1. **Gmail strips <style> blocks.** Every rule is therefore an inline
//    `style=` attribute. A stylesheet would look right in the preview and then
//    arrive naked in the customer's inbox.
// 2. **Layout has to be tables.** Flexbox and grid are unreliable across mail
//    clients; nested tables are the thing that has always worked.
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

const BRAND = "#b5622a";
const TEXT = "#2a2018";
const MUTED = "#8a7365";
const BORDER = "#ecdfd2";

export function buildEmailHtml(parts: EmailParts): string {
  const { intro, signoff, products, logoUrl, shopName, phone } = parts;

  const body = `font-family: Georgia, 'Times New Roman', serif; color: ${TEXT};`;
  const para = `${body} font-size: 15px; line-height: 1.6; margin: 0 0 14px;`;

  // Two per row. One is lonely on a desktop; three is too narrow on a phone,
  // and mail clients don't reflow reliably.
  const rows: Product[][] = [];
  for (let i = 0; i < products.length; i += 2) rows.push(products.slice(i, i + 2));

  const cell = (p: Product) => `
      <td width="50%" valign="top" style="padding: 8px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="border: 1px solid ${BORDER}; border-radius: 10px; overflow: hidden;">
          <tr>
            <td style="padding: 0;">
              ${p.photo_url
                ? `<img src="${esc(p.photo_url)}" width="260" alt="${esc(p.name)}"
                        style="display: block; width: 100%; max-width: 260px; height: auto;">`
                : `<div style="padding: 38px 0; text-align: center; font-size: 32px;
                           background: #fbf0e5; color: ${BRAND};">&#127856;</div>`}
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 12px 14px;">
              <div style="${body} font-size: 16px; font-weight: bold;">${esc(p.name)}</div>
              <div style="font-family: Arial, sans-serif; font-size: 15px; color: ${BRAND};
                          font-weight: bold; padding-top: 3px;">$${esc(p.price)}</div>
            </td>
          </tr>
        </table>
      </td>`;

  const grid = rows
    .map(
      (row) => `<tr>${row.map(cell).join("")}${
        row.length === 1 ? '<td width="50%"></td>' : ""
      }</tr>`,
    )
    .join("");

  return `<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background: #fdf7f0; padding: 24px 0;">
  <tr><td align="center">
    <table cellpadding="0" cellspacing="0" border="0" width="600"
           style="width: 600px; max-width: 100%; background: #ffffff;
                  border: 1px solid ${BORDER}; border-radius: 14px;">
      <tr>
        <td align="center" style="padding: 26px 24px 8px;">
          <img src="${esc(logoUrl)}" alt="${esc(shopName)}" width="190"
               style="display: block; width: 190px; max-width: 70%; height: auto;">
        </td>
      </tr>
      <tr>
        <td style="padding: 6px 28px 0;">
          ${intro.trim() ? paragraphs(intro, para) : ""}
        </td>
      </tr>
      <tr>
        <td style="padding: 4px 20px 0;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">${grid}</table>
        </td>
      </tr>
      <tr>
        <td style="padding: 18px 28px 6px;">
          ${signoff.trim() ? paragraphs(signoff, para) : ""}
        </td>
      </tr>
      <tr>
        <td align="center" style="padding: 10px 28px 26px; border-top: 1px solid ${BORDER};">
          <div style="${body} font-size: 17px; color: ${BRAND}; padding-top: 14px;">
            ${esc(shopName)}
          </div>
          ${phone
            ? `<div style="font-family: Arial, sans-serif; font-size: 14px; color: ${MUTED};
                       padding-top: 4px;">${esc(phone)}</div>`
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
  for (const p of parts.products) lines.push(`• ${p.name} — $${p.price}`);
  if (parts.signoff.trim()) lines.push("", parts.signoff.trim());
  lines.push("", parts.shopName);
  if (parts.phone) lines.push(parts.phone);
  return lines.join("\n");
}
