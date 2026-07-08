// Live link to the server (spec §2F/§2H). Same WebSocket the tablets use:
// orders_changed / stock_changed invalidate the matching queries so open pages
// refresh; notification events pop a toast. (No sound here — the audible ping
// is a tablet-floor behaviour; the dashboard is for oversight.)

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { wsUrl } from "../api/client";
import type { RealtimeEvent } from "../api/types";
import { useAuth } from "../auth/AuthContext";

interface Toast {
  id: number;
  message: string;
}
interface RealtimeValue {
  online: boolean;
  toasts: Toast[];
  dismiss: (id: number) => void;
}
const RealtimeContext = createContext<RealtimeValue>({ online: false, toasts: [], dismiss: () => {} });

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    if (!user) {
      setOnline(false);
      return;
    }
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (cancelled) return;
      ws = new WebSocket(wsUrl(user.token));
      ws.onopen = () => setOnline(true);
      ws.onmessage = (m) => {
        let ev: RealtimeEvent;
        try {
          ev = JSON.parse(m.data);
        } catch {
          return;
        }
        if (ev.type === "orders_changed") void queryClient.invalidateQueries({ queryKey: ["orders"] });
        else if (ev.type === "stock_changed") void queryClient.invalidateQueries({ queryKey: ["stock"] });
        else if (ev.type === "notification") {
          void queryClient.invalidateQueries({ queryKey: ["notifications"] });
          const id = nextId.current++;
          setToasts((t) => [...t, { id, message: ev.notification.message }]);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
        }
      };
      ws.onclose = () => {
        setOnline(false);
        if (!cancelled) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [user, queryClient]);

  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  return <RealtimeContext.Provider value={{ online, toasts, dismiss }}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);
