import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "path";
import { existsSync, readdirSync } from "fs";
import { settings } from "./settings.js";
import * as schema from "./schema.js";
import { DatabaseError } from "./errors.js";
import { createLogger } from "./logging.js";

const dbPath = settings.DATABASE_URL.replace("sqlite:///", "");
const absolutePath = resolve(dbPath);

// sqlite instance — created at module load time. This is intentional:
// the repos import `db` at module scope, so lazy initialization would not
// defer the actual open. The database file is opened before migrations run,
// which is safe with SQLite WAL mode.
export const sqlite = new Database(absolutePath);

// WAL mode + busy timeout + foreign keys (Python 版本等价)
sqlite.pragma(`journal_mode = ${settings.DB_JOURNAL_MODE}`);
sqlite.pragma(`busy_timeout = ${settings.DB_BUSY_TIMEOUT_MS}`);
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

/** 导出的 db 实例类型 */
export type DrizzleDatabase = typeof db;

const log = createLogger("db");

// 自动运行迁移
export function runMigrations(): void {
  const migrationsPath = resolve(process.cwd(), "config", "drizzle", "migrations");

  if (!existsSync(migrationsPath)) {
    log.warn("Migrations directory not found, skipping: " + migrationsPath);
    return;
  }

  const files = readdirSync(migrationsPath).filter(f => f.endsWith(".sql"));
  if (files.length === 0) {
    log.warn("No migration files found, skipping. Run `pnpm db:generate` first.");
    return;
  }

  try {
    migrate(db, { migrationsFolder: migrationsPath });
    log.info(`Applied ${files.length} migration(s)`);
  } catch (err) {
    log.error({ err }, "Migration failed");
    throw err;
  }
}

/** Wrap a database call with a try-catch that throws DatabaseError on failure. */
export function wrapDbCall<T>(operation: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new DatabaseError(
      `Database operation failed: ${operation}`,
      {},
      e instanceof Error ? e : new Error(String(e))
    );
  }
}
