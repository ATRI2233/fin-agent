import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { resolveProjectRoot } from './utils.js';

const router = Router();

const PROJECT_ROOT = resolveProjectRoot();
const SKILLS_DIR = path.join(PROJECT_ROOT, '.opencode', 'skills');

// Interface for skill metadata
interface SkillMeta {
  name: string;
  description: string;
  filePath: string;
}

// Helper: Parse YAML frontmatter from markdown
function parseFrontmatter(content: string): Record<string, string> {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---/;
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

// Helper: Get all skill directories
function getSkillDirs(): string[] {
  if (!fs.existsSync(SKILLS_DIR)) {
    return [];
  }
  return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
}

// Helper: Get skill metadata from directory
function getSkillMeta(skillName: string): SkillMeta | null {
  try {
    const skillMdPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      return null;
    }

    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const frontmatter = parseFrontmatter(content);

    return {
      name: frontmatter.name || skillName,
      description: frontmatter.description || '',
      filePath: skillMdPath,
    };
  } catch {
    return null;
  }
}

// GET /api/skills - List all skills
router.get('/', (_req: Request, res: Response) => {
  try {
    const skillDirs = getSkillDirs();
    const skills: SkillMeta[] = [];

    for (const skillName of skillDirs) {
      const meta = getSkillMeta(skillName);
      if (meta) {
        skills.push(meta);
      }
    }

    res.json({ skills });
  } catch (err: unknown) {
    console.error('Failed to list skills:', err);
    res.status(500).json({ error: 'Failed to list skills' });
  }
});

// GET /api/skills/:name/content - Get skill content
router.get('/:name/content', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const skillMdPath = path.join(SKILLS_DIR, name, 'SKILL.md');

    if (!fs.existsSync(skillMdPath)) {
      res.status(404).json({ error: `Skill '${name}' not found` });
      return;
    }

    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const frontmatter = parseFrontmatter(content);

    res.json({
      name: frontmatter.name || name,
      content,
      description: frontmatter.description || '',
    });
  } catch (err: unknown) {
    console.error(`Failed to read skill '${req.params.name}':`, err);
    res.status(500).json({ error: 'Failed to read skill content' });
  }
});

// PUT /api/skills/:name/content - Update skill content
router.put('/:name/content', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { content } = req.body as { content: string };

    if (!content) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    const skillDir = path.join(SKILLS_DIR, name);
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    // Ensure skill directory exists
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
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

export default router;
