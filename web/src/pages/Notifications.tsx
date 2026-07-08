// Notifications feed (§2H/§11): low/negative stock, overdue orders & tasks.
// Unread emphasized; mark read / mark all read. Live toasts also arrive via the
// realtime provider.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { listNotifications, markAllNotificationsRead, markNotificationRead } from "../api/endpoints";
import { Loading, PageHead } from "../components/ui";

const ICON: Record<string, string> = { low_stock: "📦", overdue_order: "⏰", overdue_task: "✅" };

export default function Notifications() {
  const client = useQueryClient();
  const feed = useQuery({ queryKey: ["notifications", "feed"], queryFn: () => listNotifications({ limit: 100 }) });
  const invalidate = () => client.invalidateQueries({ queryKey: ["notifications"] });
  const readOne = useMutation({ mutationFn: markNotificationRead, onSuccess: invalidate });
  const readAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: invalidate });

  return (
    <div className="page">
      <PageHead title="Notifications">
        <button className="btn neutral" onClick={() => readAll.mutate()}>Mark all read</button>
      </PageHead>

      {feed.isLoading ? (
        <Loading />
      ) : (
        <div className="card">
          {(feed.data?.items ?? []).map((n) => (
            <div
              key={n.id}
              className="row"
              style={{
                padding: "12px 0",
                borderBottom: "1px solid var(--border)",
                fontWeight: n.read ? 400 : 700,
                cursor: n.read ? "default" : "pointer",
              }}
              onClick={() => !n.read && readOne.mutate(n.id)}
            >
              <span style={{ fontSize: 20 }}>{ICON[n.type] ?? "🔔"}</span>
              <div style={{ flex: 1 }}>
                <div>{n.message}</div>
                <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{new Date(n.created_at).toLocaleString()}</div>
              </div>
              {!n.read && <span className="dot" style={{ background: "var(--primary)" }} />}
            </div>
          ))}
          {feed.data && feed.data.items.length === 0 && <p className="muted">All clear — nothing needs attention.</p>}
        </div>
      )}
    </div>
  );
}
