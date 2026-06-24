import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { resolve } from "path";

const archiveDir = resolve(process.cwd(), "config", "_archive_python");
const mainPy = resolve(archiveDir, "src/main/main.py");
const backupPy = resolve(archiveDir, "src/main/main.py.bak");

if (!existsSync(backupPy)) {
  console.error("No Python backup found in _archive_python/. Cannot rollback.");
  process.exit(1);
}

// Restore Python main.py from archive
writeFileSync(mainPy, readFileSync(backupPy, "utf-8"));
unlinkSync(backupPy);
console.log("Restored _archive_python/src/main/main.py from backup.");

console.log("\n✅ Python backend restored from archive.");
console.log("   Start:  python -m _archive_python.src.main.main");
console.log("\nTo switch again: npm run switch:to-ts");
