import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/infra/schema.ts",
  out: "./config/drizzle/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: "sqlite:///./data/finagent.db",
  },
});
