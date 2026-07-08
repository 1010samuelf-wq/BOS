// Live link to the server (spec §2F/§2H):
//  - holds a WebSocket to /api/v1/ws (token-authenticated)
//  - orders_changed / stock_changed → invalidate the matching React Query keys
//    so every open screen refetches
//  - notification events → banner/toast + sound
//  - connection state drives the "offline — reconnect to continue" banner that
//    blocks order/stock actions until the socket is back

import { useQueryClient } from "@tanstack/react-query";
import { Audio } from "expo-av";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { wsUrl } from "../api/client";
import type { RealtimeEvent } from "../api/types";
import { useAuth } from "../auth/AuthContext";

interface Toast {
  id: number;
  message: string;
}

interface RealtimeContextValue {
  online: boolean;
  toasts: Toast[];
  dismissToast: (id: number) => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  online: true,
  toasts: [],
  dismissToast: () => {},
});

const RECONNECT_MS = 3000;

async function playPing() {
  try {
    const { sound } = await Audio.Sound.createAsync(
      // Small bundled beep; the "ping" half of banner/toast + sound (§2H).
      require("../../assets/ping.wav"),
      { shouldPlay: true },
    );
    sound.setOnPlaybackStatusUpdate((s) => {
      if (s.isLoaded && s.didJustFinish) void sound.unloadAsync();
    });
  } catch {
    // Sound is best-effort; never let it break the banner.
  }
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const nextToastId = useRef(1);

  useEffect(() => {
    if (!user) {
      wsRef.current?.close();
      wsRef.current = null;
      setOnline(false);
      return;
    }

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(wsUrl(user.token));
      wsRef.current = ws;

      ws.onopen = () => setOnline(true);

      ws.onmessage = (msg) => {
        let event: RealtimeEvent;
        try {
          event = JSON.parse(String(msg.data));
        } catch {
          return;
        }
        if (event.type === "orders_changed") {
          void queryClient.invalidateQueries({ queryKey: ["orders"] });
        } else if (event.type === "stock_changed") {
          void queryClient.invalidateQueries({ queryKey: ["stock"] });
        } else if (event.type === "notification") {
          void queryClient.invalidateQueries({ queryKey: ["notifications"] });
          const id = nextToastId.current++;
          setToasts((t) => [...t, { id, message: event.notification.message }]);
          void playPing();
          // Auto-dismiss the banner; the feed keeps the full item.
          setTimeout(
            () => setToasts((t) => t.filter((x) => x.id !== id)),
            6000,
          );
        }
      };

      ws.onclose = () => {
        setOnline(false);
        if (!cancelled) retry = setTimeout(connect, RECONNECT_MS);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [user, queryClient]);

  const dismissToast = (id: number) =>
    setToasts((t) => t.filter((x) => x.id !== id));

  return (
    <RealtimeContext.Provider value={{ online, toasts, dismissToast }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export const useRealtime = () => useContext(RealtimeContext);
