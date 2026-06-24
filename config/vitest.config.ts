import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "..",
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    coverage: {
      reporter: ["text", "html"],
      exclude: ["node_modules", "dist", "src/webui"],
    },
  },
  resolve: {
    alias: {
      "@server/": new URL("../src/server/", import.meta.url).pathname,
      "@agents/": new URL("../src/agents/", import.meta.url).pathname,
    },
  },
});
