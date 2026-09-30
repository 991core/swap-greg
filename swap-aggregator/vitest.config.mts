import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL(".", import.meta.url)),
    // Next provides this marker in production; server tests run outside Next.
    "server-only": fileURLToPath(new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)),
  } },

  // Next keeps JSX in the source for its own compiler. Vitest needs to lower
  // it before Vite's import analysis runs.
  oxc: { jsx: { runtime: "automatic" } },

  test: { environment: "jsdom", setupFiles: ["./tests/setup.ts"], maxWorkers: 2, restoreMocks: true },
});
