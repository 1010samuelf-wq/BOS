// Deleted things.
//
// Nothing in the shop is destroyed any more — every delete leaves a snapshot
// here. Some kinds go straight back (a ledger line, an expense, a shift);
// others are kept for the record but have to be re-entered, because putting
// them back automatically would mean replaying stock or payment state and
// getting it half right.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiRequestError } from "../api/client";
import { listTrash, restoreTrashItem } from "../api/endpoints";
import type { TrashItem } from "../api/types";
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
        Everything deleted anywhere in the app lands here. Nothing is thrown away.
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
    </div>
  );
}
