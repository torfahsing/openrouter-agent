import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const IGNORED_NAMES = new Set(['node_modules', '.git', '.sessions']);

export const listDirTool = tool({
  name: 'list_dir',
  description: 'List the contents of a directory. Directories will be suffixed with "/" and all files/directories are sorted alphabetically. Ignores node_modules, .git, and .sessions. Capped at 500 entries.',
  inputSchema: z.object({
    path: z.string().optional().describe('Path to the directory to list (default: current working directory)'),
  }),
  execute: async ({ path }) => {
    const root = resolve(path ?? process.cwd());
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
  },
});
