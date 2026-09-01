// Feedback inbox — every note staff sent from the dashboard or the tablets.
// Admin-only (the API enforces it too); notes often name a person or describe
// something broken, so this isn't operational data for the floor.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { listFeedback, setFeedbackHandled } from "../api/endpoints";
import type { Feedback } from "../api/types";
import { LoadFailed, Loading, PageHead, Tabs } from "../components/ui";
import { formatDateTime } from "../order/dates";

function FeedbackCard({ f, onToggle, busy }: { f: Feedback; onToggle: () => void; busy: boolean }) {
  return (
    <div className="card" style={{ opacity: f.handled ? 0.6 : 1 }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 15 }}>{f.message}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {f.user_name ?? "Unknown"} · {f.source === "tablet" ? "📱 tablet" : "💻 dashboard"}
            {f.context ? ` · ${f.context}` : ""} · {formatDateTime(new Date(f.created_at))}
          </div>
        </div>
        <button className="btn neutral sm" disabled={busy} onClick={onToggle}>
          {f.handled ? "Reopen" : "Mark done"}
        </button>
      </div>
    </div>
  );
}

export default function FeedbackPage() {
  const [tab, setTab] = useState<"open" | "done">("open");
  const client = useQueryClient();
  const handled = tab === "done";

  const q = useQuery({
    queryKey: ["feedback", handled],
    queryFn: () => listFeedback({ handled }),
  });

  const toggle = useMutation({
    mutationFn: (f: Feedback) => setFeedbackHandled(f.id, !f.handled),
    onSuccess: () => client.invalidateQueries({ queryKey: ["feedback"] }),
  });

  return (
    <div className="page">
      <PageHead title="Feedback">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { key: "open", label: "Open" },
            { key: "done", label: "Done" },
          ]}
        />
      </PageHead>

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <LoadFailed what="feedback" onRetry={() => void q.refetch()} />
      ) : q.data && q.data.length > 0 ? (
        q.data.map((f) => (
          <FeedbackCard
            key={f.id}
            f={f}
            busy={toggle.isPending}
            onToggle={() => toggle.mutate(f)}
          />
        ))
      ) : (
        <div className="card muted">
          {handled ? "Nothing marked done yet." : "No open feedback."}
        </div>
      )}
    </div>
  );
}
