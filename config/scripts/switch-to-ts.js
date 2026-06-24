import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const archiveDir = resolve(process.cwd(), "config", "_archive_python");
const mainPy = resolve(archiveDir, "src/main/main.py");
const indexTs = resolve(process.cwd(), "src/server/index.ts");

if (!existsSync(mainPy)) {
  console.error("Python backend not found in _archive_python/. Run 'npm run clean:py' first if src/main/ still exists.");
  process.exit(1);
}

if (!existsSync(indexTs)) {
  console.error("TypeScript backend not found.");
  process.exit(1);
}

// Rename Python main.py so it's not accidentally started
const backupPy = resolve(archiveDir, "src/main/main.py.bak");
writeFileSync(backupPy, readFileSync(mainPy, "utf-8"));
console.log("Backed up _archive_python/src/main/main.py -> main.py.bak");

// Mark Python entry as disabled
writeFileSync(mainPy, "# DISABLED — see src/server/index.ts for new TypeScript backend\n");
console.log("Disabled Python entry point in archive.");

console.log("\n✅ Switched to TypeScript backend.");
console.log("   Start:  npm run dev:server");
console.log("   Build:  npm run build:server");
console.log("   Test:   npm run test:run");
console.log("\nTo rollback: npm run switch:to-py");
