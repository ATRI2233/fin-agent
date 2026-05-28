import express from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import configRouter from './config.js';
import agentsRouter from './agents.js';
import skillsRouter from './skills.js';
import mcpRouter from './mcp.js';
import providersRouter from './providers.js';
import toolsRouter from './tools.js';
import permissionsRouter from './permissions.js';
import rulesRouter from './rules.js';

const app = express();
const PORT = process.env.PORT || 9876;

// ── Paths ───────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIST = process.env.FIN_AGENT_HOME
  ? path.join(process.env.FIN_AGENT_HOME, 'public')
  : path.join(__dirname, '..', '..', 'dist'); // web/dist/

// ── Middleware ──────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── API routes (must come before static/slash handler) ─────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'opencode-fin-agent-server',
  });
});

app.use('/api/config', configRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/mcp', mcpRouter);
app.use('/api/providers', providersRouter);
app.use('/api/tools', toolsRouter);
app.use('/api/permissions', permissionsRouter);
app.use('/api/rules', rulesRouter);

// ── Static frontend (built by `npm run build` in web/) ─────────────
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  console.log(`[server] Serving static frontend from ${FRONTEND_DIST}`);

  // SPA fallback: any non-API GET → index.html
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'API endpoint not found' });
      return;
    }
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
} else {
  console.log(`[server] Frontend dist not found at ${FRONTEND_DIST} — API only`);
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
