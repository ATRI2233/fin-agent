import { Router, Request, Response } from 'express';
import { readConfigFile, updateConfigFile, resolveProjectRoot } from './utils.js';

const router = Router();
const PROJECT_ROOT = resolveProjectRoot();

interface McpServerConfig {
  type: string;
  command: string | string[];
  args?: string[];
  enabled: boolean;
  description?: string;
  env?: Record<string, string>;
}

// Helper: Get mcp object from config (auto-discovers global → project)
function getMcpConfig(): Record<string, McpServerConfig> {
  const { data } = readConfigFile('opencode.json', PROJECT_ROOT);
  const mcp = data['mcp'];
  if (mcp && typeof mcp === 'object' && !Array.isArray(mcp)) {
    return mcp as Record<string, McpServerConfig>;
  }
  return {};
}

// Helper: Save mcp object back to config
function saveMcpConfig(mcp: Record<string, McpServerConfig>): void {
  updateConfigFile('opencode.json', (data) => {
    data['mcp'] = mcp;
    return data;
  }, PROJECT_ROOT);
}

// GET /api/mcp - List all MCP server configurations
router.get('/', (_req: Request, res: Response) => {
  try {
    const mcp = getMcpConfig();
    res.json(mcp);
  } catch (err: unknown) {
    console.error('Failed to read MCP config:', err);
    res.status(500).json({ error: 'Failed to read MCP configuration' });
  }
});

// PUT /api/mcp/:name - Update single MCP server configuration
router.put('/:name', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const data = req.body as McpServerConfig;

    if (!name || name.trim() === '') {
      res.status(400).json({ error: 'MCP server name is required' });
      return;
    }

    const mcp = getMcpConfig();
    mcp[name] = data;
    saveMcpConfig(mcp);

    res.json({ success: true, name, config: data });
  } catch (err: unknown) {
    console.error('Failed to update MCP config:', err);
    res.status(500).json({ error: 'Failed to update MCP configuration' });
  }
});

// DELETE /api/mcp/:name - Delete MCP server
router.delete('/:name', (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    if (!name || name.trim() === '') {
      res.status(400).json({ error: 'MCP server name is required' });
      return;
    }

    const mcp = getMcpConfig();

    if (!(name in mcp)) {
      res.status(404).json({ error: `MCP server '${name}' not found` });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete mcp[name];
    saveMcpConfig(mcp);

    res.json({ success: true, deleted: name });
  } catch (err: unknown) {
    console.error('Failed to delete MCP config:', err);
    res.status(500).json({ error: 'Failed to delete MCP configuration' });
  }
});

// POST /api/mcp/:name/toggle - Enable/Disable MCP server
router.post('/:name/toggle', (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    if (!name || name.trim() === '') {
      res.status(400).json({ error: 'MCP server name is required' });
      return;
    }

    const mcp = getMcpConfig();

    if (!(name in mcp)) {
      res.status(404).json({ error: `MCP server '${name}' not found` });
      return;
    }

    mcp[name].enabled = !mcp[name].enabled;
    saveMcpConfig(mcp);

    res.json({
      success: true,
      name,
      enabled: mcp[name].enabled,
    });
  } catch (err: unknown) {
    console.error('Failed to toggle MCP config:', err);
    res.status(500).json({ error: 'Failed to toggle MCP configuration' });
  }
});

export default router;
