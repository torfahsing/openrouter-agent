import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex characters
    .replace(/\*\*/g, '.*')               // match any characters including slashes
    .replace(/(?<!\.)\*/g, '[^/]*')        // match single folder path components
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function walk(dir: string, baseDir: string, regex: RegExp, results: string[]): void {
  if (results.length >= 1000) return;
  
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Ignore unreadable directories
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.sessions') {
        continue;
      }
      walk(fullPath, baseDir, regex, results);
    } else if (entry.isFile()) {
      if (regex.test(relPath)) {
        results.push(relPath);
      }
    }
  }
}

export const globTool = tool({
  name: 'glob',
  description: 'Find files by glob pattern (e.g. "src/**/*.ts" or "docs/*.md"). Ignores node_modules, .git, and .sessions. Capped at 1000 results.',
  inputSchema: z.object({
    pattern: z.string().describe('Glob pattern to match, e.g. "packages/**/*.ts"'),
    path: z.string().optional().describe('Root directory to search within (default: current working directory)'),
  }),
  execute: async ({ pattern, path }) => {
    const root = resolve(path ?? process.cwd());
    if (!existsSync(root)) {
      return { error: `Directory not found: ${root}` };
    }

    try {
      const regex = globToRegex(pattern);
      const results: string[] = [];
      walk(root, root, regex, results);
      return { results };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});
