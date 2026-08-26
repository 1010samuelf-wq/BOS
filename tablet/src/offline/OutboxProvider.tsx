// Flushes the local outbox against POST /sync/replay whenever the app comes
// back online (real reconnect or the manual toggle flipping off), and
// exposes queue state for the offline banner + Sync Review screen (spec:
// bakery-floor offline mode).

import { useQueryClient } from "@tanstack/react-query";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { syncReplay } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { useConnectivity } from "./connectivity";
import { getDeviceId } from "./deviceId";
import * as outbox from "./outbox";
import type { OutboxEntry } from "./outbox";

interface OutboxContextValue {
  entries: OutboxEntry[];
  pendingCount: number;
  problemCount: number; // conflict + rejected — needs a human to look
  flushNow: () => void;
}

const OutboxContext = createContext<OutboxContextValue>({
  entries: [],
  pendingCount: 0,
  problemCount: 0,
  flushNow: () => {},
});

// A closed-for-a-week backlog is still well under this in practice for a
// two-tablet bakery; chunking just bounds a single request's size.
const CHUNK_SIZE = 25;

export function OutboxProvider({ children }: { children: React.ReactNode }) {
  const { isOffline } = useConnectivity();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const flushing = useRef(false);

  useEffect(() => {
    void outbox.list().then(setEntries);
    return outbox.subscribe(() => {
      void outbox.list().then(setEntries);
    });
  }, []);

  const flush = async () => {
    if (flushing.current || isOffline || !user) return;
    const pending = (await outbox.list()).filter((e) => e.status === "pending");
    if (pending.length === 0) return;

    flushing.current = true;
    try {
      const deviceId = await getDeviceId();
      for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
        const chunk = pending.slice(i, i + CHUNK_SIZE);
        const res = await syncReplay(
          deviceId,
          chunk.map((e) => ({
            client_op_id: e.client_op_id,
            type: e.type,
            acting_user_id: e.acting_user_id,
            queued_at: e.queued_at,
            payload: e.payload,
            expected_updated_at: e.expected_updated_at,
          })),
        );
        for (const r of res.results) {
          if (r.status === "applied" || r.status === "already_applied") {
            await outbox.remove(r.client_op_id);
          } else {
            await outbox.updateEntry(r.client_op_id, {
              status: r.status,
              last_error: r.error ?? undefined,
              current: r.current ?? undefined,
            });
          }
        }
      }
      // Realtime push was missing the whole time this device was offline —
      // a targeted invalidate per op isn't enough to catch up on everything
      // that changed elsewhere, so refetch everything once the flush lands.
      void queryClient.invalidateQueries();
    } finally {
      flushing.current = false;
    }
  };

  useEffect(() => {
    if (!isOffline) void flush();
    // Deliberately only re-runs on the offline/online edge (and login), not
    // on every render — flush() re-reads the queue itself each time it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOffline, user?.id]);

  const pendingCount = entries.filter((e) => e.status === "pending").length;
  const problemCount = entries.filter((e) => e.status === "conflict" || e.status === "rejected").length;

  return (
    <OutboxContext.Provider value={{ entries, pendingCount, problemCount, flushNow: () => void flush() }}>
      {children}
    </OutboxContext.Provider>
  );
}

export const useOutbox = () => useContext(OutboxContext);
