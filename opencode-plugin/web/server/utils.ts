import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ── Path resolution ────────────────────────────────────────────────

/**
 * Resolve the project root directory.
 * - If FIN_AGENT_HOME is set, use it directly (deployment mode).
 * - Otherwise walk up from server/dist/index.js to find the Git project root.
 */
export function resolveProjectRoot(): string {
  if (process.env.FIN_AGENT_HOME) {
    return process.env.FIN_AGENT_HOME;
  }
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // server/dist/ → server/ → web/ → opencode-plugin/ → project root
  return path.resolve(__dirname, '..', '..', '..', '..');
}

/**
 * Get the global opencode config directory (~/.config/opencode/)
 */
export function getGlobalConfigDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return process.env.OPENCODE_CONFIG_DIR || path.join(home, '.config', 'opencode');
}

// ── Config discovery ───────────────────────────────────────────────

export type ConfigSource = 'global' | 'project';

export interface ConfigLocation {
  path: string;
  source: ConfigSource;
  exists: boolean;
}

/**
 * Find an existing config file by searching global → project locations.
 * If neither exists, returns the project-level path as default.
 *
 * @param filename - config file name (e.g. 'opencode.json', 'oh-my-openagent.jsonc')
 * @param projectRoot - optional project root (auto-resolved if omitted)
 */
export function findConfigFile(filename: string, projectRoot?: string): ConfigLocation {
  const root = projectRoot || resolveProjectRoot();

  // Priority 1: global config
  const globalPath = path.join(getGlobalConfigDir(), filename);
  if (fs.existsSync(globalPath)) {
    return { path: globalPath, source: 'global', exists: true };
  }

  // Priority 2: project-level .opencode/
  const projectPath = path.join(root, '.opencode', filename);
  if (fs.existsSync(projectPath)) {
    return { path: projectPath, source: 'project', exists: true };
  }

  // Neither exists — default to project-level (most portable for deployment)
  return { path: projectPath, source: 'project', exists: false };
}

/**
 * Same as findConfigFile, but returns the ResolvedConfig with data loaded.
 */
export function readConfigFile(filename: string, projectRoot?: string): ConfigLocation & { data: Record<string, unknown> } {
  const loc = findConfigFile(filename, projectRoot);
  const data = loc.exists ? readJsonFile(loc.path) : {};
  return { ...loc, data };
}

/**
 * Write config data back to the appropriate location.
 * If the config was originally found (exists), it writes back to that path.
 * If it didn't exist, writes to the project-level default path.
 */
export function writeConfigFile(loc: ConfigLocation, data: Record<string, unknown>): void {
  writeJsonFile(loc.path, data);
}

/**
 * Convenience: read, modify, write in one call.
 */
export function updateConfigFile(
  filename: string,
  updater: (data: Record<string, unknown>) => Record<string, unknown>,
  projectRoot?: string,
): ConfigLocation & { data: Record<string, unknown> } {
  const result = readConfigFile(filename, projectRoot);
  const newData = updater(result.data);
  writeJsonFile(result.path, newData);
  return { ...result, data: newData };
}

// ── JSON utilities ─────────────────────────────────────────────────

/**
 * Strip JSONC comments while preserving URLs in strings
 */
export function stripJsoncComments(content: string): string {
  let result = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    const next = content[i + 1];

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        result += char;
      }
      i++;
      continue;
    }

    if (inString) {
      if (char === '\\') {
        result += char + next;
        i += 2;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      result += char;
      i++;
      continue;
    }

    // Not in string or comment
    if (char === '"') {
      inString = true;
      result += char;
      i++;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

/**
 * Read JSON/JSONC file safely. Returns {} if file doesn't exist.
 */
export function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const stripped = stripJsoncComments(content);
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

/**
 * Write JSON file with proper formatting. Auto-creates parent directories.
 */
export function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
