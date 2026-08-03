import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import React from "react";

import { AuthProvider } from "../src/auth/AuthContext";
import { RealtimeProvider } from "../src/realtime/RealtimeProvider";
import { useOTAUpdates } from "../src/updates/useOTAUpdates";

// Server is the single source of truth (§1): keep data fresh-ish and let the
// WebSocket invalidations do the real-time work.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1 },
  },
});

export default function RootLayout() {
  useOTAUpdates();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RealtimeProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </RealtimeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
