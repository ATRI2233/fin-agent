import { Router, Request, Response } from 'express';
import { readConfigFile, updateConfigFile, resolveProjectRoot } from './utils.js';

const router = Router();
const PROJECT_ROOT = resolveProjectRoot();

interface ToolConfig {
  name: string;
  description?: string;
  enabled: boolean;
  source: 'builtin' | 'mcp' | 'custom';
  mcpServer?: string;
}

// Helper: Get tools object from config (auto-discovers global → project)
function getToolsConfig(): Record<string, ToolConfig> {
  const { data } = readConfigFile('opencode.json', PROJECT_ROOT);
  const tools = data['tools'];
  if (tools && typeof tools === 'object' && !Array.isArray(tools)) {
    return tools as Record<string, ToolConfig>;
  }
  return {};
}

// Helper: Save tools object back to config
function saveToolsConfig(tools: Record<string, ToolConfig>): void {
  updateConfigFile('opencode.json', (data) => {
    data['tools'] = tools;
    return data;
  }, PROJECT_ROOT);
}

// GET /api/tools - List all tool configurations
router.get('/', (_req: Request, res: Response) => {
  try {
    const tools = getToolsConfig();
    res.json(tools);
  } catch (err: unknown) {
    console.error('Failed to read tools config:', err);
    res.status(500).json({ error: 'Failed to read tools configuration' });
  }
});

// PUT /api/tools/:name - Update single tool configuration
router.put('/:name', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const data = req.body as ToolConfig;

    if (!name || name.trim() === '') {
      res.status(400).json({ error: 'Tool name is required' });
      return;
    }

    const tools = getToolsConfig();
    tools[name] = { ...data, name };
    saveToolsConfig(tools);

    res.json({ success: true, name, config: tools[name] });
  } catch (err: unknown) {
    console.error('Failed to update tool config:', err);
    res.status(500).json({ error: 'Failed to update tool configuration' });
  }
});

export default router;
