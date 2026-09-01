import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { RealtimeProvider } from "./realtime/RealtimeProvider";
import "./styles.css";

// networkMode "always" is load-bearing, not a tuning knob.
//
// By default React Query asks its onlineManager whether the browser is online
// and *pauses* every query when it says no. That state is driven by the
// window "offline"/"online" events, and a device that drops wifi for a moment
// — or a laptop that sleeps and wakes — can latch it offline and never get the
// matching "online" event back. Once that happens nothing recovers short of a
// reload: a paused query reports status "pending" with fetchStatus "paused",
// which means isLoading is *false* and data is undefined, so pages render their
// empty shell with no spinner and no error. The shop hit exactly this and
// reported it as "the notifications dosent load at all" while the API was
// serving 200s the whole time.
//
// "always" means we never guess at connectivity: the request is attempted, and
// if the network really is down it fails and the page says so (see LoadFailed)
// instead of sitting silently empty. The app has its own connectivity signal —
// the WebSocket-backed "Offline — reconnecting" banner — which is honest
// because it reflects a connection we actually hold.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, networkMode: "always" },
    mutations: { networkMode: "always" },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RealtimeProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </RealtimeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
