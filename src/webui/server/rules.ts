import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { resolveProjectRoot } from './utils.js';

const router = Router();

const PROJECT_ROOT = resolveProjectRoot();
const RULES_PATH = path.join(PROJECT_ROOT, 'AGENTS.md');

// GET /api/rules - Read AGENTS.md
router.get('/', (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(RULES_PATH)) {
      res.json({ content: '' });
      return;
    }
    const content = fs.readFileSync(RULES_PATH, 'utf-8');
    res.json({ content });
  } catch (err) {
    console.error('Failed to read rules:', err);
    res.status(500).json({ error: 'Failed to read rules file' });
  }
});

// PUT /api/rules - Write AGENTS.md
router.put('/', (req: Request, res: Response) => {
  try {
    const { content } = req.body as { content: string };
    if (content === undefined) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }
    fs.writeFileSync(RULES_PATH, content, 'utf-8');
    res.json({ success: true, path: RULES_PATH });
  } catch (err) {
    console.error('Failed to write rules:', err);
    res.status(500).json({ error: 'Failed to write rules file' });
  }
});

export default router;
