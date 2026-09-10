import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import { resolve, relative, join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

function walkAndFind(dir: string, baseDir: string, regex: RegExp, results: any[]): void {
  if (results.length >= 100) return;
  
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.sessions') {
        continue;
      }
      walkAndFind(fullPath, baseDir, regex, results);
    } else if (entry.isFile()) {
      try {
        const text = readFileSync(fullPath, 'utf-8');
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            results.push({
              file: relative(baseDir, fullPath),
              line: i + 1,
              content: lines[i],
            });
            if (results.length >= 100) return;
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }
}

export const grepTool = tool({
  name: 'grep',
  description: 'Search file contents by regex pattern. Uses ripgrep (rg) if available, otherwise falls back to a manual search. Capped at 100 results.',
  inputSchema: z.object({
    pattern: z.string().describe('Regex pattern to search for'),
    path: z.string().optional().describe('Root directory or file to search (default: current working directory)'),
    glob: z.string().optional().describe('File filter glob, e.g. "*.ts" or "!**/test/**"'),
    ignoreCase: z.boolean().optional().describe('Perform a case-insensitive search'),
  }),
  execute: async ({ pattern, path, glob, ignoreCase }) => {
    const root = resolve(path ?? process.cwd());
    if (!existsSync(root)) {
      return { error: `Path not found: ${root}` };
    }

    // Try executing ripgrep first
    let hasRg = false;
    try {
      const check = spawnSync('rg', ['--version']);
      hasRg = check.status === 0;
    } catch {
      // Ignored
    }

    if (hasRg) {
      try {
        const args = ['--line-number', '--no-heading', '--color', 'never', '--json'];
        if (ignoreCase) args.push('-i');
        if (glob) args.push('-g', glob);
        args.push(pattern, root);

        const proc = spawnSync('rg', args, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
        if (proc.status === 2) {
          return { error: `Ripgrep failed: ${proc.stderr}` };
        }

        const matches: any[] = [];
        const lines = proc.stdout ? proc.stdout.split('\n') : [];
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'match') {
              const file = relative(root, obj.data.path.text);
              const lineNumber = obj.data.line_number;
              const content = obj.data.lines.text.replace(/\r?\n$/, '');
              matches.push({ file, line: lineNumber, content });
              if (matches.length >= 100) break;
            }
          } catch {
            // Ignore unparseable lines
          }
        }
        return { results: matches };
      } catch (err: any) {
        // Fallback to manual walk on failure
      }
    }

    // Manual search fallback
    try {
      const regexFlags = ignoreCase ? 'i' : '';
      const regex = new RegExp(pattern, regexFlags);
      const results: any[] = [];
      walkAndFind(root, root, regex, results);
      return { results };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});
