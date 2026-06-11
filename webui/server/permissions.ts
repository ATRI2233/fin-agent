import { Router, Request, Response } from 'express';
import { readConfigFile, updateConfigFile, resolveProjectRoot } from './utils.js';

const router = Router();
const PROJECT_ROOT = resolveProjectRoot();

interface PermissionRule {
  tool: string;
  action: 'allow' | 'deny';
  agents?: string[];
  description?: string;
}

interface PermissionsConfig {
  rules: PermissionRule[];
  defaultAction: 'allow' | 'deny';
}

// Helper: Get permissions object from config (auto-discovers global → project)
function getPermissionsConfig(): PermissionsConfig {
  const { data } = readConfigFile('opencode.json', PROJECT_ROOT);
  const permissions = data['permissions'];
  if (permissions && typeof permissions === 'object' && !Array.isArray(permissions)) {
    return permissions as PermissionsConfig;
  }
  return { rules: [], defaultAction: 'allow' };
}

// Helper: Save permissions object back to config
function savePermissionsConfig(permissions: PermissionsConfig): void {
  updateConfigFile('opencode.json', (data) => {
    data['permissions'] = permissions;
    return data;
  }, PROJECT_ROOT);
}

// GET /api/permissions - Get permissions configuration
router.get('/', (_req: Request, res: Response) => {
  try {
    const permissions = getPermissionsConfig();
    res.json(permissions);
  } catch (err: unknown) {
    console.error('Failed to read permissions config:', err);
    res.status(500).json({ error: 'Failed to read permissions configuration' });
  }
});

// PUT /api/permissions - Update permissions configuration
router.put('/', (req: Request, res: Response) => {
  try {
    const data = req.body as PermissionsConfig;

    // Validate structure
    if (!data.rules || !Array.isArray(data.rules)) {
      res.status(400).json({ error: 'Invalid permissions format: rules array required' });
      return;
    }

    if (!data.defaultAction || !['allow', 'deny'].includes(data.defaultAction)) {
      res.status(400).json({ error: 'Invalid permissions format: defaultAction must be allow or deny' });
      return;
    }

    savePermissionsConfig(data);

    res.json({ success: true, permissions: data });
  } catch (err: unknown) {
    console.error('Failed to update permissions config:', err);
    res.status(500).json({ error: 'Failed to update permissions configuration' });
  }
});

export default router;
