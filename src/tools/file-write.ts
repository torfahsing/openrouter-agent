import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const fileWriteTool = tool({
  name: 'file_write',
  description: 'Write content to a file, creating it and parent directories if needed.',
  inputSchema: z.object({
    path: z.string().describe('Absolute path to the file to create/overwrite'),
    content: z.string().describe('Content to write to the file'),
  }),
  execute: async ({ path, content }) => {
    try {
      const dir = dirname(path);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, content, 'utf-8');
      return { written: true, path };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});
