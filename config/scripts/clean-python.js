import { existsSync, rmSync } from "fs";
import { resolve } from "path";

const paths = [
  "alembic",
  "alembic.ini",
  "requirements.txt",
  "setup.py",
];

const archiveDir = resolve(process.cwd(), "config", "_archive_python");

console.log("Cleaning up remaining Python artifacts...\n");

for (const p of paths) {
  const abs = resolve(process.cwd(), p);
  if (existsSync(abs)) {
    const dest = resolve(archiveDir, p);
    rmSync(dest, { recursive: true, force: true });
    rmSync(abs, { recursive: true, force: true });
    console.log(`  Archived & removed: ${p}`);
  } else {
    console.log(`  Already gone: ${p}`);
  }
}

// Also clean any remaining Python cache
const cachePaths = [
  "src/tests/__pycache__",
  "src/main/__pycache__",
  "config/.pytest_cache",
];
for (const p of cachePaths) {
  const abs = resolve(process.cwd(), p);
  if (existsSync(abs)) {
    rmSync(abs, { recursive: true, force: true });
    console.log(`  Removed cache: ${p}`);
  }
}

console.log("\n✅ Python artifacts cleaned up");
console.log("   Archive location: _archive_python/");
console.log("   To fully delete:  rm -rf _archive_python");
