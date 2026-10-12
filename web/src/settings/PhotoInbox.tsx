// Settings → Photo inbox.
//
// Two jobs that are often two people: one uploads a batch of pictures (the
// person with the camera), another goes through them and says which product
// each one is (the person who knows the catalog). Assigning adds the photo to
// that product's gallery exactly as uploading it on the Products tab would.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { ApiRequestError } from "../api/client";
import * as api from "../api/endpoints";
import type { InboxPhoto, Product } from "../api/types";
import { LoadFailed, Loading, isStalled } from "../components/ui";
import { formatDateTime } from "../order/dates";
import { type BatchResult, productOptions, uploadBatch } from "./photoInbox";

const message = (e: unknown) => (e instanceof ApiRequestError ? e.message : "Action failed.");

export default function PhotoInbox() {
  const client = useQueryClient();
  const inbox = useQuery({ queryKey: ["photo-inbox"], queryFn: api.listInboxPhotos });
  const products = useQuery({ queryKey: ["products", true], queryFn: () => api.listProducts(true) });

  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [lastBatch, setLastBatch] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["photo-inbox"] });
    client.invalidateQueries({ queryKey: ["products"] });
  };

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (inputRef.current) inputRef.current.value = ""; // same files can be picked again
    if (files.length === 0) return;
    setLastBatch(null);
    setError(null);
    const result = await uploadBatch(files, api.uploadInboxPhoto, (done, total) => {
      setProgress({ done, total });
      // Show each photo as it lands rather than all at the end.
      if (done > 0) client.invalidateQueries({ queryKey: ["photo-inbox"] });
    });
    setProgress(null);
    setLastBatch(result);
    refresh();
  }

  const uploading = progress !== null;
  const photos = inbox.data ?? [];

  return (
    <>
      <div className="card">
        <h2>Upload photos</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
          Pick as many as you like — they wait here until someone matches each one to a
          product. JPEG, PNG or WEBP, up to 5 MB each.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          style={{ display: "none" }}
          onChange={(e) => void onFiles(e.target.files)}
        />
        <button className="btn primary" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? `Uploading ${progress.done} of ${progress.total}…` : "Choose photos"}
        </button>
        {lastBatch && (
          <div style={{ marginTop: 10 }}>
            {lastBatch.uploaded > 0 && (
              <p className="muted" style={{ margin: 0 }}>
                Uploaded {lastBatch.uploaded} photo{lastBatch.uploaded === 1 ? "" : "s"}.
              </p>
            )}
            {lastBatch.failed.length > 0 && (
              <div className="error">
                {lastBatch.failed.length} didn't upload:
                <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                  {lastBatch.failed.map((f, i) => (
                    <li key={i}>{f.name} — {f.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Waiting to be assigned{photos.length > 0 ? ` (${photos.length})` : ""}</h2>
        {error && <p className="error">{error}</p>}
        {inbox.isLoading || products.isLoading ? (
          <Loading />
        ) : isStalled(inbox) ? (
          <LoadFailed what="the photo inbox" onRetry={() => void inbox.refetch()} />
        ) : isStalled(products) ? (
          <LoadFailed what="the product list" onRetry={() => void products.refetch()} />
        ) : photos.length === 0 ? (
          <p className="muted">Nothing waiting. Uploaded photos show up here.</p>
        ) : (
          <div className="inbox-grid">
            {photos.map((ph) => (
              <InboxCard
                key={ph.id}
                photo={ph}
                products={products.data ?? []}
                onDone={refresh}
                onError={(e) => setError(message(e))}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function InboxCard({
  photo, products, onDone, onError,
}: {
  photo: InboxPhoto;
  products: Product[];
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const [productId, setProductId] = useState("");
  const assign = useMutation({
    mutationFn: () => api.assignInboxPhoto(photo.id, Number(productId)),
    onSuccess: onDone,
    onError,
  });
  const discard = useMutation({
    mutationFn: () => api.discardInboxPhoto(photo.id),
    onSuccess: onDone,
    onError,
  });
  const busy = assign.isPending || discard.isPending;

  return (
    <div className="inbox-item">
      {/* Opens full size in a new tab — a thumbnail isn't always enough to
          tell two similar cakes apart. */}
      <a href={photo.url} target="_blank" rel="noreferrer">
        <img src={photo.url} alt={photo.filename ?? "Uploaded photo"} loading="lazy" />
      </a>
      <div className="muted" style={{ fontSize: 12, margin: "6px 0" }}>
        {photo.filename && <div className="inbox-filename">{photo.filename}</div>}
        {photo.uploaded_by_name ?? "Someone"} · {formatDateTime(new Date(photo.uploaded_at))}
      </div>
      <select
        className="input"
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        disabled={busy}
        aria-label="Product"
      >
        <option value="">Which product is this?</option>
        {productOptions(products).map((g) => (
          <optgroup key={g.category} label={g.category}>
            {g.options.map((o) => (
              <option key={o.id} value={o.id} disabled={o.disabled}>{o.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <button className="btn primary sm" disabled={!productId || busy} onClick={() => assign.mutate()}>
          {assign.isPending ? "Assigning…" : "Assign"}
        </button>
        <button
          className="btn neutral sm"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Discard this photo? It can be put back from the Deleted page.")) {
              discard.mutate();
            }
          }}
        >
          Discard
        </button>
      </div>
    </div>
  );
}
