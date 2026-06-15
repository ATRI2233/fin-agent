import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { resolveProjectRoot, getGlobalConfigDir, readConfigFile, readJsonFile, updateConfigFile } from './utils.js';

const router = Router();

const PROJECT_ROOT = resolveProjectRoot();
const PROJECT_SKILLS_DIR = path.join(PROJECT_ROOT, '.opencode', 'skills');

// Security: validate name to prevent path traversal
function safeName(name: string): boolean {
  return !!name && !name.includes('..') && !name.includes('/') && !name.includes('\\') && !name.includes('\0');
}

// Interface for skill metadata
interface SkillMeta {
  name: string;
  description: string;
  filePath: string;
  enabled: boolean;
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

// Helper: Resolve skills directory and config for a given scope
function getScopePaths(scope?: string): { skillsDir: string | null; configKey: string } {
  if (scope === 'global') {
    const globalDir = getGlobalConfigDir();
    return { skillsDir: path.join(globalDir, 'skills'), configKey: 'global' };
  }
  // Default: project scope
  return { skillsDir: PROJECT_SKILLS_DIR, configKey: 'project' };
}

// Helper: Read global skills from opencode config's `skills` section
function getGlobalSkillsFromConfig(): SkillMeta[] {
  const config = readConfigFile('opencode.json', PROJECT_ROOT);
  const configuredSkills = config.data.skills as Record<string, unknown> | undefined;
  const skills: SkillMeta[] = [];

  if (!configuredSkills || typeof configuredSkills !== 'object') {
    return skills;
  }

  for (const [skillName, skillConfig] of Object.entries(configuredSkills)) {
    try {
      if (!skillConfig || typeof skillConfig !== 'object') continue;
      const entry = skillConfig as Record<string, unknown>;
      const skillPath = entry.path as string | undefined;
      if (!skillPath || !fs.existsSync(skillPath)) continue;

      const content = fs.readFileSync(skillPath, 'utf-8');
      const frontmatter = parseFrontmatter(content);
      skills.push({
        name: frontmatter.name || skillName,
        description: frontmatter.description || '',
        filePath: skillPath,
        enabled: entry.disabled !== true,
      });
    } catch {
      // Skip invalid skill entries
    }
  }
  return skills;
}

// Helper: Get project skill directories
function getProjectSkillDirs(): string[] {
  if (!fs.existsSync(PROJECT_SKILLS_DIR)) {
    return [];
  }
  return fs.readdirSync(PROJECT_SKILLS_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
}

// Helper: Get project skill metadata from directory
function getProjectSkillMeta(skillName: string): SkillMeta | null {
  try {
    const skillMdPath = path.join(PROJECT_SKILLS_DIR, skillName, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      return null;
    }

    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const frontmatter = parseFrontmatter(content);

    return {
      name: frontmatter.name || skillName,
      description: frontmatter.description || '',
      filePath: skillMdPath,
      enabled: true,
    };
  } catch {
    return null;
  }
}

// Helper: Resolve skill file path by scope
function resolveSkillPath(name: string, scope?: string): string | null {
  if (scope === 'global') {
    const config = readConfigFile('opencode.json', PROJECT_ROOT);
    const configuredSkills = config.data.skills as Record<string, unknown> | undefined;
    if (configuredSkills && typeof configuredSkills === 'object') {
      const entry = configuredSkills[name] as Record<string, unknown> | undefined;
      if (entry && typeof entry.path === 'string' && fs.existsSync(entry.path)) {
        return entry.path;
      }
    }
    return null;
  }
  // Project scope
  const skillMdPath = path.join(PROJECT_SKILLS_DIR, name, 'SKILL.md');
  return fs.existsSync(skillMdPath) ? skillMdPath : null;
}

// Helper: Read skill content from a given file path
function readSkillFromPath(skillMdPath: string, name: string) {
  const content = fs.readFileSync(skillMdPath, 'utf-8');
  const frontmatter = parseFrontmatter(content);
  return {
    name: frontmatter.name || name,
    content,
    description: frontmatter.description || '',
  };
}

// Helper: Get skills for a scope by checking config first, then filesystem
function getSkillsForScope(scope: string): SkillMeta[] {
  // Global: always read from global opencode config's skills section
  if (scope === 'global') {
    return getGlobalSkillsFromConfig();
  }

  // Project: check for project-level opencode.json with skills section first
  const projectConfigPath = path.join(PROJECT_ROOT, '.opencode', 'opencode.json');
  if (fs.existsSync(projectConfigPath)) {
    const projectConfig = readJsonFile(projectConfigPath);
    const configuredSkills = projectConfig.skills as Record<string, unknown> | undefined;
    if (configuredSkills && typeof configuredSkills === 'object') {
      const skills: SkillMeta[] = [];
      for (const [skillName, skillConfig] of Object.entries(configuredSkills)) {
        try {
          if (!skillConfig || typeof skillConfig !== 'object') continue;
          const entry = skillConfig as Record<string, unknown>;
          const skillPath = entry.path as string | undefined;
          if (!skillPath || !fs.existsSync(skillPath)) continue;
          const content = fs.readFileSync(skillPath, 'utf-8');
          const frontmatter = parseFrontmatter(content);
          skills.push({
            name: frontmatter.name || skillName,
            description: frontmatter.description || '',
            filePath: skillPath,
            enabled: entry.disabled !== true,
          });
        } catch {
          // skip
        }
      }
      if (skills.length > 0) return skills;
    }
  }

  // Fallback: scan .opencode/skills/ directory for SKILL.md files
  const skillDirs = getProjectSkillDirs();
  const skills: SkillMeta[] = [];
  for (const dirName of skillDirs) {
    const meta = getProjectSkillMeta(dirName);
    if (meta) {
      skills.push(meta);
    }
  }
  return skills;
}

// GET /api/skills?scope=global|project - List all skills by scope
router.get('/', (req: Request, res: Response) => {
  try {
    const scope = (req.query.scope as string) || 'project';
    const skills = getSkillsForScope(scope);
    res.json({ skills });
  } catch (err: unknown) {
    console.error('Failed to list skills:', err);
    res.status(500).json({ error: 'Failed to list skills' });
  }
});

// GET /api/skills/:name/content?scope=global|project - Get skill content
router.get('/:name/content', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    if (!safeName(name)) { res.status(400).json({ error: 'Invalid skill name' }); return; }
    const scope = req.query.scope as string | undefined;
    const skillMdPath = resolveSkillPath(name, scope);

    if (!skillMdPath) {
      res.status(404).json({ error: `Skill '${name}' not found in ${scope || 'project'} scope` });
      return;
    }

    const result = readSkillFromPath(skillMdPath, name);
    res.json(result);
  } catch (err: unknown) {
    console.error(`Failed to read skill '${req.params.name}':`, err);
    res.status(500).json({ error: 'Failed to read skill content' });
  }
});

// PUT /api/skills/:name/content?scope=global|project - Update skill content
router.put('/:name/content', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    if (!safeName(name)) { res.status(400).json({ error: 'Invalid skill name' }); return; }
    const { content } = req.body as { content: string };
    const scope = req.query.scope as string | undefined;

    if (!content) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    let skillMdPath: string;

    if (scope === 'global') {
      // For global skills, we need to write to the path from config
      const config = readConfigFile('opencode.json', PROJECT_ROOT);
      const configuredSkills = config.data.skills as Record<string, unknown> | undefined;
      if (configuredSkills && typeof configuredSkills === 'object') {
        const entry = configuredSkills[name] as Record<string, unknown> | undefined;
        if (entry && typeof entry.path === 'string') {
          skillMdPath = entry.path;
        } else {
          res.status(404).json({ error: `Global skill '${name}' not found in config` });
          return;
        }
      } else {
        res.status(404).json({ error: `Global skill '${name}' not found in config` });
        return;
      }
    } else {
      // Project scope: write to .opencode/skills/<name>/SKILL.md
      const skillDir = path.join(PROJECT_SKILLS_DIR, name);
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }
      skillMdPath = path.join(skillDir, 'SKILL.md');
    }

    fs.writeFileSync(skillMdPath, content, 'utf-8');

    res.json({
      success: true,
      name,
      path: skillMdPath,
    });
  } catch (err: unknown) {
    console.error(`Failed to update skill '${req.params.name}':`, err);
    res.status(500).json({ error: 'Failed to update skill content' });
  }
});

// DELETE /api/skills/:name?scope=global|project - Delete a skill
router.delete('/:name', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    if (!safeName(name)) { res.status(400).json({ error: 'Invalid skill name' }); return; }
    const scope = (req.query.scope as string) || 'project';

    if (scope === 'global') {
      // Remove from global config's skills section
      updateConfigFile('opencode.json', (data) => {
        const skills = data.skills as Record<string, unknown> | undefined;
        if (skills && typeof skills === 'object') {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete (skills as Record<string, unknown>)[name];
        }
        return data;
      }, PROJECT_ROOT);
    } else {
      // Remove from project .opencode/opencode.json skills section
      const projectConfigPath = path.join(PROJECT_ROOT, '.opencode', 'opencode.json');
      if (fs.existsSync(projectConfigPath)) {
        const projectConfig = readJsonFile(projectConfigPath);
        const skills = projectConfig.skills as Record<string, unknown> | undefined;
        if (skills && typeof skills === 'object') {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete (skills as Record<string, unknown>)[name];
          const dir = path.dirname(projectConfigPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(projectConfigPath, JSON.stringify(projectConfig, null, 2), 'utf-8');
        }
      }
    }

    res.json({ success: true, deleted: name });
  } catch (err: unknown) {
    console.error(`Failed to delete skill '${req.params.name}':`, err);
    res.status(500).json({ error: 'Failed to delete skill' });
  }
});

// POST /api/skills/:name/toggle?scope=global|project - Toggle skill enabled/disabled
router.post('/:name/toggle', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    if (!safeName(name)) { res.status(400).json({ error: 'Invalid skill name' }); return; }
    const scope = (req.query.scope as string) || 'project';
    let enabled = true;

    if (scope === 'global') {
      updateConfigFile('opencode.json', (data) => {
        const skills = data.skills as Record<string, unknown> | undefined;
        if (skills && typeof skills === 'object') {
          const entry = skills[name] as Record<string, unknown> | undefined;
          if (entry) {
            entry.disabled = !entry.disabled;
            enabled = !entry.disabled;
          } else {
            skills[name] = { disabled: false };
            enabled = true;
          }
        }
        return data;
      }, PROJECT_ROOT);
    } else {
      const projectConfigPath = path.join(PROJECT_ROOT, '.opencode', 'opencode.json');
      if (fs.existsSync(projectConfigPath)) {
        const projectConfig = readJsonFile(projectConfigPath);
        const skills = projectConfig.skills as Record<string, unknown> | undefined;
        if (skills && typeof skills === 'object') {
          const entry = skills[name] as Record<string, unknown> | undefined;
          if (entry) {
            entry.disabled = !entry.disabled;
            enabled = !entry.disabled;
          }
        }
        const dir = path.dirname(projectConfigPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(projectConfigPath, JSON.stringify(projectConfig, null, 2), 'utf-8');
      }
    }

    res.json({ success: true, name, enabled });
  } catch (err: unknown) {
    console.error(`Failed to toggle skill '${req.params.name}':`, err);
    res.status(500).json({ error: 'Failed to toggle skill' });
  }
});

// POST /api/skills/:name/move - Move skill between scopes
router.post('/:name/move', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    if (!safeName(name)) { res.status(400).json({ error: 'Invalid skill name' }); return; }
    const { from } = req.body as { from: string };

    if (from === 'global') {
      // Remove from global config, add to project
      // Read current path from global config
      readConfigFile('opencode.json', PROJECT_ROOT);
      // First update global config to remove
      let skillPath = '';
      updateConfigFile('opencode.json', (data) => {
        const skills = data.skills as Record<string, unknown> | undefined;
        if (skills && typeof skills === 'object') {
          const entry = skills[name] as Record<string, unknown> | undefined;
          if (entry && typeof entry.path === 'string') {
            skillPath = entry.path;
          }
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete (skills as Record<string, unknown>)[name];
        }
        return data;
      }, PROJECT_ROOT);

      // Add to project .opencode/opencode.json
      const projectConfigPath = path.join(PROJECT_ROOT, '.opencode', 'opencode.json');
      const projectConfig = fs.existsSync(projectConfigPath)
        ? readJsonFile(projectConfigPath)
        : {};
      if (!projectConfig.skills || typeof projectConfig.skills !== 'object') {
        projectConfig.skills = {};
      }
      (projectConfig.skills as Record<string, unknown>)[name] = {
        path: skillPath,
        disabled: false,
      };
      const dir = path.dirname(projectConfigPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(projectConfigPath, JSON.stringify(projectConfig, null, 2), 'utf-8');

      res.json({ success: true, name, to: 'project' });
    } else {
      // Remove from project, add to global
      const projectConfigPath = path.join(PROJECT_ROOT, '.opencode', 'opencode.json');
      let skillPath = '';
      if (fs.existsSync(projectConfigPath)) {
        const projectConfig = readJsonFile(projectConfigPath);
        const skills = projectConfig.skills as Record<string, unknown> | undefined;
        if (skills && typeof skills === 'object') {
          const entry = skills[name] as Record<string, unknown> | undefined;
          if (entry && typeof entry.path === 'string') {
            skillPath = entry.path;
          }
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete (skills as Record<string, unknown>)[name];
        }
        fs.writeFileSync(projectConfigPath, JSON.stringify(projectConfig, null, 2), 'utf-8');
      }

      // If no path found, use the project skills dir
      if (!skillPath) {
        const projectMdPath = path.join(PROJECT_SKILLS_DIR, name, 'SKILL.md');
        if (fs.existsSync(projectMdPath)) {
          skillPath = projectMdPath;
        }
      }

      updateConfigFile('opencode.json', (data) => {
        if (!data.skills || typeof data.skills !== 'object') {
          data.skills = {};
        }
        (data.skills as Record<string, unknown>)[name] = {
          path: skillPath,
          disabled: false,
        };
        return data;
      }, PROJECT_ROOT);

      res.json({ success: true, name, to: 'global' });
    }
  } catch (err: unknown) {
    console.error(`Failed to move skill '${req.params.name}':`, err);
    res.status(500).json({ error: 'Failed to move skill' });
  }
});

export default router;
