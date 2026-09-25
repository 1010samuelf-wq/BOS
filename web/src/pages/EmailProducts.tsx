// Email products to a customer.
//
// Nothing is sent from here. The page builds the email and hands it to the
// person's own mailbox — "Copy email" puts it on the clipboard as rich HTML so
// pasting into any mail client keeps the logo, photos and layout. That means no
// sending domain to warm up, no bounces to handle, and replies land in the inbox
// of whoever sent it, which is what the shop actually wants.
//
// "Open email app" is a convenience, not the main path. It's a mailto: link, so
// the OS picks the app — Android offers whatever is installed, Windows opens the
// default — because the shop doesn't only use Gmail. It carries the subject and
// nothing else; the body is the rich version sitting on the clipboard.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ApiRequestError } from "../api/client";
import * as api from "../api/endpoints";
import type { EmailTemplate, Product } from "../api/types";
import { ErrorMsg, LoadFailed, Loading, PageHead, isStalled } from "../components/ui";
import { buildEmailHtml, buildEmailText, type EmailParts } from "../email/buildEmail";

const DEFAULT_INTRO =
  "Hi,\n\nHere's a look at what we have available. Let us know what you'd like and " +
  "we'll get it ready for you.";
const DEFAULT_SIGNOFF = "Thank you,\nJust Cake";

export default function EmailProducts() {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [subject, setSubject] = useState("From Just Cake");
  const [intro, setIntro] = useState(DEFAULT_INTRO);
  const [signoff, setSignoff] = useState(DEFAULT_SIGNOFF);
  const [templateName, setTemplateName] = useState("");
  const [loadedTemplate, setLoadedTemplate] = useState<number | null>(null);

  // Retired products aren't offered: there's no point emailing a customer a
  // photo and price for something the shop has stopped selling.
  const products = useQuery({
    queryKey: ["products", true],
    queryFn: () => api.listProducts(true),
  });
  const categories = useQuery({ queryKey: ["product-categories"], queryFn: api.listCategories });
  const profile = useQuery({ queryKey: ["business"], queryFn: api.getBusinessProfile });
  const templates = useQuery({ queryKey: ["email-templates"], queryFn: api.listEmailTemplates });

  const onErr = (e: unknown) =>
    setError(e instanceof ApiRequestError ? e.message : "That didn't work.");
  const invalidate = () => client.invalidateQueries({ queryKey: ["email-templates"] });

  const saveTemplate = useMutation({
    mutationFn: () => {
      const body = {
        name: templateName.trim(),
        subject,
        intro,
        signoff,
        product_ids: picked,
      };
      return loadedTemplate === null
        ? api.createEmailTemplate(body)
        : api.updateEmailTemplate(loadedTemplate, body);
    },
    onSuccess: (t) => { setLoadedTemplate(t.id); setError(null); invalidate(); },
    onError: onErr,
  });
  const removeTemplate = useMutation({
    mutationFn: (id: number) => api.deleteEmailTemplate(id),
    onSuccess: (_v, id) => {
      if (id === loadedTemplate) { setLoadedTemplate(null); setTemplateName(""); }
      invalidate();
    },
    onError: onErr,
  });

  // The order they were ticked in is the order they appear in the email, so
  // someone can lead with the thing they're actually pitching.
  const chosen = useMemo(
    () => picked
      .map((id) => (products.data ?? []).find((p) => p.id === id))
      .filter((p): p is Product => p !== undefined),
    [picked, products.data],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (products.data ?? []).filter(
      (p) =>
        p.active &&
        (!category || p.category === category) &&
        (!term || p.name.toLowerCase().includes(term)),
    );
  }, [products.data, search, category]);

  const parts: EmailParts = {
    subject,
    intro,
    signoff,
    products: chosen,
    // Self-correcting: whichever domain the dashboard is open on serves the
    // logo, so the email points at a host that is actually reachable.
    logoUrl: `${window.location.origin}/logo.png`,
    shopName: profile.data?.business_name || "Just Cake",
    phone: profile.data?.business_phone,
  };
  const html = buildEmailHtml(parts);

  async function copyEmail() {
    setError(null);
    try {
      // Both flavours: rich clients (Gmail, Outlook) take the HTML, anything
      // else falls back to the text rather than pasting nothing.
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([buildEmailText(parts)], { type: "text/plain" }),
        }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Couldn't copy — your browser blocked clipboard access. Try Chrome.");
    }
  }

  function openMailApp() {
    // mailto:, not a Gmail link. It hands the OS the job, so Android offers
    // whatever mail apps are installed and Windows opens the default one —
    // the shop doesn't only use Gmail. Subject only: the body is the rich
    // version on the clipboard, and pre-filling plain text here would just be
    // something to delete before pasting.
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}`;
  }

  function applyTemplate(t: EmailTemplate) {
    setLoadedTemplate(t.id);
    setTemplateName(t.name);
    setSubject(t.subject);
    setIntro(t.intro ?? "");
    setSignoff(t.signoff ?? "");
    // Templates keep ids, so anything since deleted quietly drops out rather
    // than putting a missing product in the email.
    const live = new Set((products.data ?? []).map((p) => p.id));
    setPicked(t.product_ids.filter((id) => live.has(id)));
  }

  if (products.isLoading) return <div className="page"><Loading /></div>;
  if (isStalled(products)) {
    return (
      <div className="page">
        <LoadFailed what="the products" onRetry={() => void products.refetch()} />
      </div>
    );
  }

  const missingFromTemplate =
    loadedTemplate !== null
      ? (templates.data ?? []).find((t) => t.id === loadedTemplate)?.product_ids.filter(
          (id) => !(products.data ?? []).some((p) => p.id === id),
        ).length ?? 0
      : 0;

  return (
    <div className="page">
      <PageHead title="Email products">
        <button className="btn neutral" disabled={chosen.length === 0} onClick={() => void copyEmail()}>
          {copied ? "✓ Copied" : "📋 Copy email"}
        </button>
        <button className="btn primary" disabled={!subject.trim()} onClick={openMailApp}>
          ✉ Open email app
        </button>
      </PageHead>

      <p className="muted" style={{ marginTop: -4 }}>
        Pick what you want to show, press <strong>Copy email</strong>, then open your mail
        app and paste — the pictures and layout come with it. It sends from your own address,
        so replies come back to you.
      </p>

      {error && <ErrorMsg>{error}</ErrorMsg>}
      {missingFromTemplate > 0 && (
        <p className="muted" style={{ fontSize: 13 }}>
          {missingFromTemplate} product{missingFromTemplate > 1 ? "s" : ""} from this template
          {missingFromTemplate > 1 ? " are" : " is"} no longer in the catalog and{" "}
          {missingFromTemplate > 1 ? "have" : "has"} been left out.
        </p>
      )}

      <div className="email-layout">
        {/* ---- pick ---- */}
        <div className="card">
          <h2>Products {chosen.length > 0 && <span className="muted">· {chosen.length} picked</span>}</h2>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <input
              className="input"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 140 }}
            />
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{ maxWidth: 170 }}
            >
              <option value="">All categories</option>
              {(categories.data ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {picked.length > 0 && (
              <button className="btn neutral sm" onClick={() => setPicked([])}>Clear</button>
            )}
          </div>

          <div className="email-picker">
            {visible.map((p) => {
              const on = picked.includes(p.id);
              return (
                <button
                  key={p.id}
                  className={`email-pick${on ? " is-picked" : ""}`}
                  onClick={() =>
                    setPicked((cur) => (on ? cur.filter((x) => x !== p.id) : [...cur, p.id]))
                  }
                >
                  {p.photo_url
                    ? <img src={p.photo_url} alt="" />
                    : <span className="email-pick-empty">🍰</span>}
                  <span className="email-pick-name">{p.name}</span>
                  <span className="email-pick-price">${p.price}</span>
                  {on && <span className="email-pick-tick">{picked.indexOf(p.id) + 1}</span>}
                </button>
              );
            })}
            {visible.length === 0 && <p className="muted">Nothing matches.</p>}
          </div>
        </div>

        {/* ---- write ---- */}
        <div className="card">
          <h2>Wording</h2>
          <label className="email-label">Subject</label>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <label className="email-label">Above the products</label>
          <textarea className="input" rows={4} value={intro} onChange={(e) => setIntro(e.target.value)} />
          <label className="email-label">Below the products</label>
          <textarea className="input" rows={3} value={signoff} onChange={(e) => setSignoff(e.target.value)} />

          <h2 style={{ marginTop: 18 }}>Templates</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
            A template saves the wording <strong>and</strong> the products.
          </p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <input
              className="input"
              placeholder="Template name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              style={{ flex: 1, minWidth: 150 }}
            />
            <button
              className="btn primary sm"
              disabled={!templateName.trim() || saveTemplate.isPending}
              onClick={() => saveTemplate.mutate()}
            >
              {loadedTemplate === null ? "Save new" : "Update"}
            </button>
            {loadedTemplate !== null && (
              <button
                className="btn neutral sm"
                onClick={() => { setLoadedTemplate(null); setTemplateName(""); }}
              >
                Save as new instead
              </button>
            )}
          </div>

          <div className="email-templates">
            {(templates.data ?? []).map((t) => (
              <div key={t.id} className={`email-template${t.id === loadedTemplate ? " is-active" : ""}`}>
                <button className="email-template-open" onClick={() => applyTemplate(t)}>
                  <span className="email-template-name">{t.name}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {t.product_ids.length} product{t.product_ids.length === 1 ? "" : "s"}
                  </span>
                </button>
                <button
                  className="btn neutral sm"
                  title="Delete this template"
                  onClick={() => removeTemplate.mutate(t.id)}
                >
                  ✕
                </button>
              </div>
            ))}
            {(templates.data ?? []).length === 0 && (
              <p className="muted" style={{ fontSize: 13 }}>No templates saved yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* ---- preview ---- */}
      <div className="card">
        <h2>Preview</h2>
        {chosen.length === 0 ? (
          <p className="muted">Pick some products and they'll appear here.</p>
        ) : (
          <>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
              Subject: <strong>{subject}</strong>
            </div>
            {/* The real HTML, rendered — what gets copied is exactly this. */}
            <div className="email-preview" dangerouslySetInnerHTML={{ __html: html }} />
          </>
        )}
      </div>
    </div>
  );
}
