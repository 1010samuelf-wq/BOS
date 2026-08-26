import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import React from "react";

import { AuthProvider } from "../src/auth/AuthContext";
import { ConnectivityProvider } from "../src/offline/connectivity";
import { OutboxProvider } from "../src/offline/OutboxProvider";
import { RealtimeProvider } from "../src/realtime/RealtimeProvider";
import { useOTAUpdates } from "../src/updates/useOTAUpdates";

// Server is the single source of truth (§1): keep data fresh-ish and let the
// WebSocket invalidations do the real-time work. gcTime is long (well beyond
// the default 5min) because persisted data has to survive an overnight or
// holiday closure and still be there — dimmed/labeled stale — when a baker
// opens the app offline the next morning.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, gcTime: 1000 * 60 * 60 * 24 * 3 },
  },
});

// Own AsyncStorage key, separate from the session (`bos.session`) and the
// write-outbox (`bos.outbox`) — a persisted read-cache miss is just a blank
// screen, never something that should touch auth or queued writes.
const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "bos.query-cache",
});

export default function RootLayout() {
  useOTAUpdates();

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
      <AuthProvider>
        <RealtimeProvider>
          <ConnectivityProvider>
            <OutboxProvider>
              <Stack screenOptions={{ headerShown: false }} />
            </OutboxProvider>
          </ConnectivityProvider>
        </RealtimeProvider>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
