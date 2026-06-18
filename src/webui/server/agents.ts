import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { resolveProjectRoot, readConfigFile, updateConfigFile } from './utils.js';

const router = Router();

const PROJECT_ROOT = resolveProjectRoot();
const AGENTS_DIR = path.join(PROJECT_ROOT, '.opencode', 'agents');

// Security: validate name to prevent path traversal
function safeName(name: string): boolean {
  return !!name && !name.includes('..') && !name.includes('/') && !name.includes('\\') && !name.includes('\0');
}

// Interface for agent metadata
interface AgentMeta {
  name: string;
  description: string;
  mode: string;
  filePath: string;
}

// Helper: Parse YAML frontmatter from markdown
function parseFrontmatter(content: string): Record<string, string> {
  const frontmatterRegex = /^---[\r]?\n([\s\S]*?)[\r]?\n---/;
  const match = content.match(frontmatterRegex);
  if (!match) {
    return {};
  }

  const frontmatter: Record<string, string> = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }
    const key = line.substring(0, colonIndex).trim();
    const value = line.substring(colonIndex + 1).trim();
    if (key && value) {
      frontmatter[key] = value;
    }
  }

  return frontmatter;
}

// Helper: Get all agent files
function getAgentFiles(): string[] {
  if (!fs.existsSync(AGENTS_DIR)) {
    return [];
  }
  return fs.readdirSync(AGENTS_DIR)
    .filter(file => file.endsWith('.md'))
    .map(file => path.join(AGENTS_DIR, file));
}

// Helper: Get agent metadata from file
function getAgentMeta(filePath: string): AgentMeta | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const frontmatter = parseFrontmatter(content);
    const name = path.basename(filePath, '.md');

    return {
      name,
      description: frontmatter.description || '',
      mode: frontmatter.mode || 'subagent',
      filePath,
    };
  } catch {
    return null;
  }
}

// GET /api/agents - List all agents
router.get('/', (_req: Request, res: Response) => {
  try {
    const agentFiles = getAgentFiles();
    const agents: AgentMeta[] = [];

    for (const filePath of agentFiles) {
      const meta = getAgentMeta(filePath);
      if (meta) {
        agents.push(meta);
      }
    }

    res.json({ agents });
  } catch (err: unknown) {
    console.error('Failed to list agents:', err);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

// GET /api/agents/:name/content - Get agent content
router.get('/:name/content', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    if (!safeName(name)) { res.status(400).json({ error: 'Invalid agent name' }); return; }
    const filePath = path.join(AGENTS_DIR, `${name}.md`);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `Agent '${name}' not found` });
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const frontmatter = parseFrontmatter(content);

    res.json({
      name,
      content,
      description: frontmatter.description || '',
      mode: frontmatter.mode || 'subagent',
    });
  } catch (err: unknown) {
    console.error(`Failed to read agent '${req.params.name}':`, err);
    res.status(500).json({ error: 'Failed to read agent content' });
  }
});

// PUT /api/agents/:name/content - Update agent content
router.put('/:name/content', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    if (!safeName(name)) { res.status(400).json({ error: 'Invalid agent name' }); return; }
    const { content } = req.body as { content: string };

    if (!content) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    // Ensure agents directory exists
    if (!fs.existsSync(AGENTS_DIR)) {
      fs.mkdirSync(AGENTS_DIR, { recursive: true });
    }

    const filePath = path.join(AGENTS_DIR, `${name}.md`);
    // Final safety: ensure resolved path is inside AGENTS_DIR
    if (!path.resolve(filePath).startsWith(path.resolve(AGENTS_DIR))) {
      res.status(400).json({ error: 'Invalid agent name' }); return;
    }
    fs.writeFileSync(filePath, content, 'utf-8');

    res.json({
      success: true,
      name,
      path: filePath,
    });
  } catch (err: unknown) {
    console.error(`Failed to update agent '${req.params.name}':`, err);
    res.status(500).json({ error: 'Failed to update agent content' });
  }
});

// GET /api/agents/models - Get model assignment for each agent
router.get('/models', (_req: Request, res: Response) => {
  try {
    const config = readConfigFile('opencode.json', PROJECT_ROOT);
    const agentSection = config.data.agent as Record<string, unknown> | undefined;
    const models: Record<string, string> = {};

    if (agentSection && typeof agentSection === 'object') {
      for (const [name, cfg] of Object.entries(agentSection)) {
        if (cfg && typeof cfg === 'object') {
          const entry = cfg as Record<string, unknown>;
          if (typeof entry.model === 'string') {
            models[name] = entry.model;
          }
        }
      }
    }

    res.json({ models });
  } catch (err: unknown) {
    console.error('Failed to get agent models:', err);
    res.status(500).json({ error: 'Failed to get agent models' });
  }
});

// POST /api/agents/batch-model - Set the same model for all agents
router.post('/batch-model', (req: Request, res: Response) => {
  try {
    const { model } = req.body as { model: string };
    if (!model) {
      res.status(400).json({ error: 'Model name is required' });
      return;
    }

    const agentFiles = getAgentFiles();
    let agentCount = 0;

    updateConfigFile('opencode.json', (data) => {
      if (!data.agent || typeof data.agent !== 'object') {
        data.agent = {};
      }
      const agentSection = data.agent as Record<string, unknown>;

      for (const filePath of agentFiles) {
        const name = path.basename(filePath, '.md');
        if (!agentSection[name] || typeof agentSection[name] !== 'object') {
          agentSection[name] = {};
        }
        (agentSection[name] as Record<string, unknown>).model = model;
        agentCount++;
      }

      return data;
    }, PROJECT_ROOT);

    res.json({ success: true, agentCount });
  } catch (err: unknown) {
    console.error('Failed to batch-set model:', err);
    res.status(500).json({ error: 'Failed to batch-set model' });
  }
});

// GET /api/agents/:name/tools-whitelist - Get agent's tools whitelist
router.get('/:name/tools-whitelist', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    if (!safeName(name)) { res.status(400).json({ error: 'Invalid agent name' }); return; }
    const config = readConfigFile('opencode.json', PROJECT_ROOT);
    const agentSection = config.data.agent as Record<string, unknown> | undefined;
    
    let whitelist: string[] = [];
    if (agentSection && typeof agentSection === 'object') {
      const agentCfg = agentSection[name] as Record<string, unknown> | undefined;
      if (agentCfg && typeof agentCfg.tools === 'object' && agentCfg.tools !== null) {
        // opencode format: { "tool_name": true, "*": false }
        const tools = agentCfg.tools as Record<string, boolean>;
        whitelist = Object.entries(tools)
          .filter(([key, val]) => key !== '*' && val === true)
          .map(([key]) => key);
      }
    }

    res.json({ name, tools_whitelist: whitelist });
  } catch (err: unknown) {
    console.error(`Failed to get tools whitelist for '${req.params.name}':`, err);
    res.status(500).json({ error: 'Failed to get tools whitelist' });
  }
});

// PUT /api/agents/:name/tools-whitelist - Update agent's tools whitelist
router.put('/:name/tools-whitelist', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    if (!safeName(name)) { res.status(400).json({ error: 'Invalid agent name' }); return; }
    const { tools_whitelist } = req.body as { tools_whitelist: string[] };

    if (!Array.isArray(tools_whitelist)) {
      res.status(400).json({ error: 'tools_whitelist must be an array' });
      return;
    }

    updateConfigFile('opencode.json', (data) => {
      if (!data.agent || typeof data.agent !== 'object') {
        data.agent = {};
      }
      const agentSection = data.agent as Record<string, unknown>;
      if (!agentSection[name] || typeof agentSection[name] !== 'object') {
        agentSection[name] = {};
      }
      // Convert to opencode format: { "tool_name": true, "*": false }
      const tools: Record<string, boolean> = {};
      for (const toolName of tools_whitelist) {
        tools[toolName] = true;
      }
      tools['*'] = false; // Default: deny all other tools
      (agentSection[name] as Record<string, unknown>).tools = tools;
      return data;
    }, PROJECT_ROOT);

    res.json({ success: true, name, tools_whitelist });
  } catch (err: unknown) {
    console.error(`Failed to update tools whitelist for '${req.params.name}':`, err);
    res.status(500).json({ error: 'Failed to update tools whitelist' });
  }
});

export default router;
