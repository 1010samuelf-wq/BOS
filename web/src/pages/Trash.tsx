// Deleted things.
//
// Nothing in the shop is destroyed any more — every delete leaves a snapshot
// here. Some kinds go straight back (a ledger line, an expense, a shift);
// others are kept for the record but have to be re-entered, because putting
// them back automatically would mean replaying stock or payment state and
// getting it half right.
//
// Retired products sit here too, in their own section. Turning a product off is
// not a delete — the row stays, and order history keeps pointing at it — but it
// is the same intent ("we don't sell this any more") and the same question
// later ("where did it go?"). Keeping it in the Settings catalog meant a list
// that grew forever and mixed what's on offer with what isn't.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiRequestError } from "../api/client";
import { listProducts, listTrash, restoreTrashItem, updateProduct } from "../api/endpoints";
import type { Product, TrashItem } from "../api/types";
import { ErrorMsg, LoadFailed, Loading, PageHead, isStalled } from "../components/ui";
import { formatDateTime } from "../order/dates";

const KIND_LABEL: Record<string, string> = {
  ledger_entry: "Ledger line",
  expense: "Expense",
  time_entry: "Shift",
  order: "Order",
  customer: "Customer",
};
const KIND_ICON: Record<string, string> = {
  ledger_entry: "📒",
  expense: "🧾",
  time_entry: "⏱",
  order: "🧁",
  customer: "🧑‍🍳",
};

export default function Trash() {
  const client = useQueryClient();
  const [showRestored, setShowRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ["trash", showRestored],
    queryFn: () => listTrash(showRestored),
  });

  const putBack = useMutation({
    mutationFn: (id: number) => restoreTrashItem(id),
    onSuccess: () => {
      setError(null);
      // A restored row reappears in whichever screen owns it.
      client.invalidateQueries();
    },
    onError: (e: unknown) =>
      setError(e instanceof ApiRequestError ? e.message : "That couldn't be put back."),
  });

  return (
    <div className="page">
      <PageHead title="Deleted">
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={showRestored}
            onChange={(e) => setShowRestored(e.target.checked)}
          />
          Include already restored
        </label>
      </PageHead>

      <p className="muted" style={{ marginTop: -4 }}>
        Everything deleted anywhere in the app lands here, along with products
        that have been turned off. Nothing is thrown away.
      </p>

      {error && <ErrorMsg>{error}</ErrorMsg>}

      {q.isLoading ? (
        <Loading />
      ) : isStalled(q) ? (
        <LoadFailed what="the deleted items" onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <div className="card"><p className="muted">Nothing has been deleted.</p></div>
      ) : (
        <div className="card">
          {(q.data ?? []).map((item: TrashItem) => (
            <div key={item.id} className="trash-row">
              <span style={{ fontSize: 20 }}>{KIND_ICON[item.kind] ?? "🗑"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="trash-label">{item.label}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {KIND_LABEL[item.kind] ?? item.kind}
                  {" · deleted "}
                  {formatDateTime(new Date(item.deleted_at))}
                  {item.deleted_by_name ? ` by ${item.deleted_by_name}` : ""}
                  {item.restored_at ? " · put back" : ""}
                </div>
                {open === item.id && (
                  <pre className="trash-payload">{JSON.stringify(item.payload, null, 2)}</pre>
                )}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button
                  className="btn neutral sm"
                  onClick={() => setOpen(open === item.id ? null : item.id)}
                >
                  {open === item.id ? "Hide" : "Details"}
                </button>
                {item.restorable ? (
                  <button
                    className="btn primary sm"
                    disabled={putBack.isPending}
                    onClick={() => putBack.mutate(item.id)}
                  >
                    Put back
                  </button>
                ) : (
                  <span
                    className="muted"
                    style={{ fontSize: 12, maxWidth: 150 }}
                    title="Kept for the record — re-enter it by hand"
                  >
                    {item.restored_at ? "" : "Re-enter by hand"}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <RetiredProducts onError={setError} />
    </div>
  );
}


/** Products that were turned off in Settings.
 *
 * Separate from the trash list because they are not trash rows: the product
 * still exists, so putting one back is a flag flip rather than a restore, and
 * it always works.
 */
function RetiredProducts({ onError }: { onError: (message: string | null) => void }) {
  const client = useQueryClient();

  const q = useQuery({
    queryKey: ["products", false],
    queryFn: () => listProducts(false),
  });

  const putBack = useMutation({
    mutationFn: (p: Product) => updateProduct(p.id, { active: true }),
    onSuccess: () => {
      onError(null);
      // It reappears in the Settings catalog, search and the tap grid.
      client.invalidateQueries();
    },
    onError: (e: unknown) =>
      onError(e instanceof ApiRequestError ? e.message : "That couldn't be put back."),
  });

  // A failure has to be visible: an empty section and a broken one look
  // identical otherwise, and someone hunting for a product they turned off
  // would conclude it was gone for good.
  if (isStalled(q)) {
    return (
      <div className="card">
        <LoadFailed what="the retired products" onRetry={() => void q.refetch()} />
      </div>
    );
  }
  // Nothing retired is the normal state — don't take up the screen saying so.
  if (q.isLoading || (q.data ?? []).length === 0) return null;

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Retired products</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
        Turned off in Settings, so they're out of search, the tap grid and new
        orders. Past orders still show them. Put one back and it returns to the
        catalog.
      </p>
      {(q.data ?? []).map((p) => (
        <div key={p.id} className="trash-row">
          <span style={{ fontSize: 20 }}>🥐</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="trash-label">{p.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Product · ${p.price}
              {p.category ? ` · ${p.category}` : ""}
            </div>
          </div>
          <button
            className="btn primary sm"
            disabled={putBack.isPending}
            onClick={() => putBack.mutate(p)}
          >
            Put back
          </button>
        </div>
      ))}
    </div>
  );
}
