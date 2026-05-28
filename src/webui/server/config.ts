import { Router, Request, Response } from 'express';
import * as path from 'path';
import { readConfigFile, writeConfigFile, readJsonFile, writeJsonFile, resolveProjectRoot } from './utils.js';

const router = Router();

const PROJECT_ROOT = resolveProjectRoot();

// GET /api/config/opencode - Read opencode.json (auto-discovers global → project)
router.get('/opencode', (_req: Request, res: Response) => {
  try {
    const { data, source, path: configPath } = readConfigFile('opencode.json', PROJECT_ROOT);
    res.json({ ...data, _meta: { source, path: configPath } });
  } catch (err: unknown) {
    console.error('Failed to read opencode config:', err);
    res.status(500).json({ error: 'Failed to read config file' });
  }
});

// PUT /api/config/opencode - Write opencode.json (back to where it was found)
router.put('/opencode', (req: Request, res: Response) => {
  try {
    const data = req.body as Record<string, unknown>;
    const loc = readConfigFile('opencode.json', PROJECT_ROOT);
    writeConfigFile(loc, data);
    res.json({ success: true, path: loc.path, source: loc.source });
  } catch (err: unknown) {
    console.error('Failed to write opencode config:', err);
    res.status(500).json({ error: 'Failed to write config file' });
  }
});

// GET /api/config/opencode/project - Force-read project-level opencode.json
router.get('/opencode/project', (_req: Request, res: Response) => {
  try {
    const projectConfigPath = path.join(PROJECT_ROOT, '.opencode', 'opencode.json');
    const config = readJsonFile(projectConfigPath);
    res.json(config);
  } catch (err: unknown) {
    console.error('Failed to read project opencode config:', err);
    res.status(500).json({ error: 'Failed to read project config file' });
  }
});

// PUT /api/config/opencode/project - Force-write project-level opencode.json
router.put('/opencode/project', (req: Request, res: Response) => {
  try {
    const data = req.body as Record<string, unknown>;
    const projectConfigPath = path.join(PROJECT_ROOT, '.opencode', 'opencode.json');
    writeJsonFile(projectConfigPath, data);
    res.json({ success: true, path: projectConfigPath });
  } catch (err: unknown) {
    console.error('Failed to write project opencode config:', err);
    res.status(500).json({ error: 'Failed to write project config file' });
  }
});

// GET /api/config/oh-my-openagent - Read oh-my-openagent.jsonc
router.get('/oh-my-openagent', (_req: Request, res: Response) => {
  try {
    const { data, source, path: configPath } = readConfigFile('oh-my-openagent.jsonc', PROJECT_ROOT);
    res.json({ ...data, _meta: { source, path: configPath } });
  } catch (err: unknown) {
    console.error('Failed to read oh-my-openagent config:', err);
    res.status(500).json({ error: 'Failed to read oh-my-openagent config file' });
  }
});

// PUT /api/config/oh-my-openagent - Write oh-my-openagent.jsonc
router.put('/oh-my-openagent', (req: Request, res: Response) => {
  try {
    const data = req.body as Record<string, unknown>;
    const loc = readConfigFile('oh-my-openagent.jsonc', PROJECT_ROOT);
    writeConfigFile(loc, data);
    res.json({ success: true, path: loc.path, source: loc.source });
  } catch (err: unknown) {
    console.error('Failed to write oh-my-openagent config:', err);
    res.status(500).json({ error: 'Failed to write oh-my-openagent config file' });
  }
});

export default router;
