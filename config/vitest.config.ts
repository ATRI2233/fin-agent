import { defineConfig } from "vitest/config";

export default defineConfig({
  root: new URL("..", import.meta.url).pathname,
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    coverage: {
      reporter: ["text", "html"],
      exclude: ["node_modules", "dist", "src/webui"],
    },
  },
});
