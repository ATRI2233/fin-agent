import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "path";
import { existsSync, readdirSync } from "fs";
import { settings } from "./settings.js";
import * as schema from "./schema.js";
import { DatabaseError } from "./errors.js";

const dbPath = settings.DATABASE_URL.replace("sqlite:///", "");
const absolutePath = resolve(dbPath);

export const sqlite = new Database(absolutePath);

// WAL mode + busy timeout (Python 版本等价)
sqlite.pragma("journal_mode = WAL");
sqlite.pragma(`busy_timeout = ${settings.DB_BUSY_TIMEOUT_MS}`);

export const db = drizzle(sqlite, { schema });

/** 导出的 db 实例类型 */
export type Database = typeof db;

// 自动运行迁移
export function runMigrations(): void {
  const migrationsPath = resolve(process.cwd(), "config", "drizzle", "migrations");
  
  if (!existsSync(migrationsPath)) {
    console.warn("[DB] Migrations directory not found, skipping: " + migrationsPath);
    return;
  }
  
  const files = readdirSync(migrationsPath).filter(f => f.endsWith(".sql"));
  if (files.length === 0) {
    console.warn("[DB] No migration files found, skipping. Run `pnpm db:generate` first.");
    return;
  }
  
  migrate(db, { migrationsFolder: migrationsPath });
  console.log(`[DB] Applied ${files.length} migration(s)`);
}

/** Wrap a database call with a try-catch that throws DatabaseError on failure. */
export function wrapDbCall<T>(operation: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new DatabaseError(`Database operation failed: ${operation}`, { cause: String(e) });
  }
}
