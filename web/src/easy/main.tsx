// Just Cake Easy: the same shop, the same API and sign-in as the dashboard,
// laid out for a tablet with big pictures and big buttons. Built from this
// codebase as a second page (easy.html) and served by its own Fly app.
//
// networkMode "always" for the same reason as the dashboard (see
// ../main.tsx): never let React Query pause on a guess that we're offline.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";

import { AuthProvider } from "../auth/AuthContext";
import EasyApp from "./EasyApp";
import "./easy.css";

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
        <EasyApp />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
