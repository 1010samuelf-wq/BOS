import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
// from vitest/config, not vite — the plain one has no `test` key in its types.
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Two pages from one codebase: the dashboard, and Just Cake Easy (the big-
  // button tablet layout). Both share the API client, sign-in and tests; the
  // easy one is served by its own Fly app (fly.easy.toml).
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        easy: resolve(__dirname, "easy.html"),
      },
    },
  },
  test: {
    // jsdom because the store tests touch localStorage and window events.
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
