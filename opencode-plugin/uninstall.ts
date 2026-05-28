#!/usr/bin/env node

/**
 * OpenCode FinAgent Plugin - Uninstall Script
 * 
 * This script removes all files and configurations installed by the plugin.
 * 
 * Usage:
 *   node uninstall.ts [--keep-config]
 * 
 * Options:
 *   --keep-config  Keep the opencode.json configuration (only remove files)
 */

import { promises as fs } from "node:fs";
import path from "node:path";

// Files and directories to remove
const AGENTS_TO_REMOVE = [
  "fin-orchestrator.md",
  "macro-scout.md",
  "sector-rotator.md",
  "sentiment-decoder.md",
  "technical-chartist.md",
  "fundamental-auditor.md",
  "smart-money-hound.md",
  "risk-gatekeeper.md",
  "fusion-brain.md",
];

const SKILLS_TO_REMOVE = [
  "fin-analysis-workflow",
];

// MCP servers to remove from config
const MCP_SERVERS_TO_REMOVE = [
  "fin-agent-mcp-server",
  "fred-mcp-server",
  "ashare-mcp-server",
  "risk-mcp-server",
  "sec-edgar-mcp",
];

// Agent configs to remove from opencode.json
const AGENT_CONFIGS_TO_REMOVE = [
  "fin-orchestrator",
  "macro-scout",
  "sector-rotator",
  "sentiment-decoder",
  "technical-chartist",
  "fundamental-auditor",
  "smart-money-hound",
  "risk-gatekeeper",
  "fusion-brain",
];

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function removeFile(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    console.log(`  ✓ Removed: ${filePath}`);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return false; // File doesn't exist, skip
    }
    console.error(`  ✗ Failed to remove ${filePath}: ${(err as Error).message}`);
    return false;
  }
}

async function removeDirectory(dirPath: string): Promise<boolean> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
    console.log(`  ✓ Removed directory: ${dirPath}`);
    return true;
  } catch (err) {
    console.error(`  ✗ Failed to remove directory ${dirPath}: ${(err as Error).message}`);
    return false;
  }
}

async function readJsonSafe(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function writeJsonSafe(filePath: string, data: Record<string, unknown>): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

async function main() {
  const args = process.argv.slice(2);
  const keepConfig = args.includes("--keep-config");

  console.log("OpenCode FinAgent Plugin - Uninstall");
  console.log("====================================\n");

  const projectRoot = process.cwd();
  const agentsDir = path.join(projectRoot, ".opencode", "agents");
  const skillsDir = path.join(projectRoot, ".opencode", "skills");
  const configPath = path.join(projectRoot, "opencode.json");

  // Step 1: Remove agent files
  console.log("Step 1: Removing agent definition files...");
  let agentsRemoved = 0;
  for (const agent of AGENTS_TO_REMOVE) {
    const filePath = path.join(agentsDir, agent);
    if (await removeFile(filePath)) {
      agentsRemoved++;
    }
  }
  console.log(`  Removed ${agentsRemoved} agent file(s)\n`);

  // Step 2: Remove skill directories
  console.log("Step 2: Removing skill definitions...");
  for (const skill of SKILLS_TO_REMOVE) {
    const skillDir = path.join(skillsDir, skill);
    await removeDirectory(skillDir);
  }
  console.log();

  // Step 3: Update opencode.json (unless --keep-config)
  if (!keepConfig) {
    console.log("Step 3: Updating opencode.json...");
    const config = await readJsonSafe(configPath);
    
    if (config) {
      // Remove MCP servers
      if (config.mcp && typeof config.mcp === "object") {
        const mcp = config.mcp as Record<string, unknown>;
        for (const server of MCP_SERVERS_TO_REMOVE) {
          if (server in mcp) {
            delete mcp[server];
            console.log(`  ✓ Removed MCP server: ${server}`);
          }
        }
      }

      // Remove agent configs
      if (config.agents && typeof config.agents === "object") {
        const agents = config.agents as Record<string, unknown>;
        for (const agent of AGENT_CONFIGS_TO_REMOVE) {
          if (agent in agents) {
            delete agents[agent];
            console.log(`  ✓ Removed agent config: ${agent}`);
          }
        }
      }

      // Remove skill references
      if (config.skills && typeof config.skills === "object") {
        const skills = config.skills as Record<string, unknown>;
        for (const skill of SKILLS_TO_REMOVE) {
          if (skill in skills) {
            delete skills[skill];
            console.log(`  ✓ Removed skill reference: ${skill}`);
          }
        }
      }

      await writeJsonSafe(configPath, config);
      console.log(`  ✓ Updated ${configPath}`);
    } else {
      console.log("  No opencode.json found, skipping config update");
    }
  } else {
    console.log("Step 3: Skipping config update (--keep-config flag)\n");
  }

  // Summary
  console.log("\n====================================");
  console.log("Uninstall complete!");
  console.log("\nRemoved:");
  console.log(`  - ${agentsRemoved} agent definition files`);
  console.log(`  - ${SKILLS_TO_REMOVE.length} skill definition(s)`);
  
  if (!keepConfig) {
    console.log(`  - ${MCP_SERVERS_TO_REMOVE.length} MCP server configs`);
    console.log(`  - ${AGENT_CONFIGS_TO_REMOVE.length} agent configs`);
  }

  console.log("\nNote: The plugin package itself was not removed.");
  console.log("To fully remove the plugin, delete the opencode-plugin/ directory.");
  console.log("\nPlease restart opencode for changes to take effect.");
}

main().catch((err) => {
  console.error("Uninstall failed:", err);
  process.exit(1);
});
