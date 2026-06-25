import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

export default defineConfig({
  root: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
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
