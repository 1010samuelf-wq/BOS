import react from "@vitejs/plugin-react";
// from vitest/config, not vite — the plain one has no `test` key in its types.
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    // jsdom because the store tests touch localStorage and window events.
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
