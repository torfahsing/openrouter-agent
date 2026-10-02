import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const IGNORED_NAMES = new Set(['node_modules', '.git', '.sessions']);

export const listDirSchema = z.object({
  path: z.string().optional().describe('Path to the directory to list (default: current working directory)'),
  dir: z.string().optional().describe('Alias for path'),
  directory: z.string().optional().describe('Alias for path'),
});

export const executeListDir = async ({ path, dir, directory }: { path?: string; dir?: string; directory?: string }) => {
  const root = resolve(path || dir || directory || process.cwd());
  if (!existsSync(root)) {
    return { error: `Directory not found: ${root}` };
  }

  try {
    const entries = readdirSync(root, { withFileTypes: true });
    const items = entries
      .filter((entry) => !IGNORED_NAMES.has(entry.name))
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .slice(0, 500);

    return {
      path: root,
      entries: items,
      totalEntries: entries.length,
      truncated: entries.length > 500,
    };
  } catch (err: any) {
    return { error: err.message };
  }
};

export const listDirTool = tool({
  name: 'list_dir',
  description: 'List the contents of a directory. Directories will be suffixed with "/" and all files/directories are sorted alphabetically. Ignores node_modules, .git, and .sessions. Capped at 500 entries.',
  inputSchema: listDirSchema,
  execute: executeListDir,
});

export const listFilesTool = tool({
  name: 'list_files',
  description: 'List the contents of a directory (alias for list_dir)',
  inputSchema: listDirSchema,
  execute: executeListDir,
});

export const lsTool = tool({
  name: 'ls',
  description: 'List the contents of a directory (alias for list_dir)',
  inputSchema: listDirSchema,
  execute: executeListDir,
});
