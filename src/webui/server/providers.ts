import { Router, Request, Response } from 'express';
import { readConfigFile, updateConfigFile, resolveProjectRoot } from './utils.js';

const router = Router();
const PROJECT_ROOT = resolveProjectRoot();

interface ProviderModelConfig { name: string; }
interface ProviderConfig { name: string; npm: string; options?: Record<string, unknown>; models?: Record<string, ProviderModelConfig>; }
// --- Active provider/model ---
// Stored at provider.active to match opencode CLI convention
function getActiveConfig(): { provider: string; model: string } {
  const { data } = readConfigFile('opencode.json', PROJECT_ROOT);
  const prov = data['provider'];
  if (prov && typeof prov === 'object' && !Array.isArray(prov)) {
    const active = (prov as Record<string, unknown>)['active'];
    if (active && typeof active === 'object') {
      const a = active as Record<string, string>;
      return { provider: a.provider || '', model: a.model || '' };
    }
  }
  return { provider: '', model: '' };
}

function setActiveConfig(provider: string, model: string): void {
  updateConfigFile('opencode.json', (data) => {
    if (!data['provider'] || typeof data['provider'] !== 'object') {
      data['provider'] = {};
    }
    (data['provider'] as Record<string, unknown>)['active'] = { provider, model };
    return data;
  }, PROJECT_ROOT);
}

// Helper: Get provider object from config (auto-discovers global → project)
function getProviderConfig(): Record<string, ProviderConfig> {
  const { data } = readConfigFile('opencode.json', PROJECT_ROOT);
  const provider = data['provider'];
  if (provider && typeof provider === 'object' && !Array.isArray(provider)) {
    return provider as Record<string, ProviderConfig>;
  }
  return {};
}

// Helper: Save provider object back to config
function saveProviderConfig(provider: Record<string, ProviderConfig>): void {
  updateConfigFile('opencode.json', (data) => {
    data['provider'] = provider;
    return data;
  }, PROJECT_ROOT);
}

// GET /api/providers - List all providers + active config
router.get('/', (_req: Request, res: Response) => {
  try {
    const providers = getProviderConfig();
    const active = getActiveConfig();
    res.json({ providers, active });
  } catch (err: unknown) {
    console.error('Failed to read providers config:', err);
    res.status(500).json({ error: 'Failed to read providers configuration' });
  }
});

// PUT /api/providers/:name - Update single provider configuration
router.put('/:name', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const data = req.body as ProviderConfig;

    if (!name || name.trim() === '') {
      res.status(400).json({ error: 'Provider name is required' });
      return;
    }

    const providers = getProviderConfig();
    providers[name] = data;
    saveProviderConfig(providers);

    res.json({ success: true, name, config: data });
  } catch (err: unknown) {
    console.error('Failed to update provider config:', err);
    res.status(500).json({ error: 'Failed to update provider configuration' });
  }
});

// DELETE /api/providers/:name - Delete provider
router.delete('/:name', (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    if (!name || name.trim() === '') {
      res.status(400).json({ error: 'Provider name is required' });
      return;
    }

    const providers = getProviderConfig();

    if (!(name in providers)) {
      res.status(404).json({ error: `Provider '${name}' not found` });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete providers[name];
    saveProviderConfig(providers);

    res.json({ success: true, deleted: name });
  } catch (err: unknown) {
    console.error('Failed to delete provider config:', err);
    res.status(500).json({ error: 'Failed to delete provider configuration' });
  }
});

// GET /api/providers/active - Get active provider + model
router.get('/active', (_req: Request, res: Response) => {
  try {
    res.json(getActiveConfig());
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to read active provider' });
  }
});

// PUT /api/providers/active - Set active provider + model
router.put('/active', (req: Request, res: Response) => {
  try {
    const { provider, model } = req.body as { provider: string; model: string };
    if (!provider) {
      res.status(400).json({ error: 'provider is required' });
      return;
    }
    // Validate provider exists
    const providers = getProviderConfig();
    if (!(provider in providers)) {
      res.status(404).json({ error: `Provider '${provider}' not found` });
      return;
    }
    setActiveConfig(provider, model || '');
    res.json({ success: true, provider, model: model || '' });
  } catch (err: unknown) {
    console.error('Failed to set active provider:', err);
    res.status(500).json({ error: 'Failed to set active provider' });
  }
});

export default router;
