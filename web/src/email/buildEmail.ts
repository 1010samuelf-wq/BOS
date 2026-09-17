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
const BRAND_DARK = "#8a441a";
const TEXT = "#2a2018";
const MUTED = "#8a7365";
const BORDER = "#ecdfd2";
const CREAM = "#fdf7f0";

export function buildEmailHtml(parts: EmailParts): string {
  const { intro, signoff, products, logoUrl, shopName, phone } = parts;

  const serif = `font-family: Georgia, 'Times New Roman', serif; color: ${TEXT};`;
  const sans = "font-family: Arial, Helvetica, sans-serif;";
  const para = `${serif} font-size: 16px; line-height: 1.65; margin: 0 0 14px;`;

  // Two per row. One looks lonely on a desktop; three goes too narrow on a
  // phone, and mail clients won't reflow a table for you.
  const rows: Product[][] = [];
  for (let i = 0; i < products.length; i += 2) rows.push(products.slice(i, i + 2));

  const cell = (p: Product) => `
      <td width="50%" valign="top" style="padding: 7px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background: #ffffff; border: 1px solid ${BORDER};
                      border-radius: 12px; overflow: hidden;">
          <tr>
            <td style="padding: 0; line-height: 0;">
              ${p.photo_url
                ? `<img src="${esc(p.photo_url)}" width="268" alt="${esc(p.name)}"
                        style="display: block; width: 100%; max-width: 268px; height: auto;">`
                : `<div style="padding: 44px 0; text-align: center; font-size: 34px;
                           background: #fbf0e5; color: ${BRAND}; line-height: 1;">&#127856;</div>`}
            </td>
          </tr>
          <tr>
            <td style="padding: 13px 14px 15px;">
              <div style="${serif} font-size: 17px; font-weight: bold; line-height: 1.3;">${esc(p.name)}</div>
              <div style="${sans} font-size: 13px; color: #ffffff; background: ${BRAND};
                          display: inline-block; padding: 4px 10px; border-radius: 999px;
                          margin-top: 8px; font-weight: bold;">$${esc(p.price)}</div>
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
       style="background: ${CREAM}; padding: 28px 0; margin: 0;">
  <tr><td align="center">
    <table cellpadding="0" cellspacing="0" border="0" width="620"
           style="width: 620px; max-width: 100%; background: #ffffff;
                  border: 1px solid ${BORDER}; border-radius: 16px; overflow: hidden;">

      <tr>
        <td align="center"
            style="background: ${BRAND}; padding: 4px 0 0; line-height: 0; font-size: 0;">&nbsp;</td>
      </tr>

      <tr>
        <td align="center" style="padding: 30px 28px 4px;">
          <img src="${esc(logoUrl)}" alt="${esc(shopName)}" width="200"
               style="display: block; width: 200px; max-width: 72%; height: auto;">
        </td>
      </tr>
      <tr>
        <td align="center" style="padding: 12px 28px 0;">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="border-top: 2px solid ${BRAND}; width: 54px; line-height: 0;
                       font-size: 0;">&nbsp;</td>
          </tr></table>
        </td>
      </tr>

      ${intro.trim()
        ? `<tr><td style="padding: 20px 34px 2px;">${paragraphs(intro, para)}</td></tr>`
        : ""}

      <tr>
        <td style="padding: 8px 20px 0;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">${grid}</table>
        </td>
      </tr>

      ${signoff.trim()
        ? `<tr><td style="padding: 22px 34px 4px;">${paragraphs(signoff, para)}</td></tr>`
        : ""}

      <tr>
        <td align="center" style="background: ${CREAM}; padding: 22px 28px 24px;
                                  border-top: 1px solid ${BORDER};">
          <div style="${serif} font-size: 19px; color: ${BRAND_DARK}; font-weight: bold;">
            ${esc(shopName)}
          </div>
          ${phone
            ? `<div style="${sans} font-size: 14px; color: ${MUTED}; padding-top: 5px;">
                 ${esc(phone)}
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
  for (const p of parts.products) lines.push(`• ${p.name} — $${p.price}`);
  if (parts.signoff.trim()) lines.push("", parts.signoff.trim());
  lines.push("", parts.shopName);
  if (parts.phone) lines.push(parts.phone);
  return lines.join("\n");
}
