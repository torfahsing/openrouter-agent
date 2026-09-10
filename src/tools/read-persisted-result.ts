import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { isInsideStorageDir } from '../tool-offload.js';

const DEFAULT_LIMIT = 10_000;

export function createReadPersistedResultTool(storageDir: string) {
  return tool({
    name: 'read_persisted_result',
    description:
      `Read a section of a previously-persisted oversized tool result. The path comes from a prior tool response's persistedAt field and must be inside the offload storage directory (${storageDir}). Supports offset/limit pagination. Do NOT use this tool to read regular files, source code, or session transcripts; use file_read for those.`,
    inputSchema: z.object({
      path: z.string().describe('Path returned in a previous tool result\'s persistedAt field'),
      offset: z.number().optional().describe('Byte offset to start from (default 0)'),
      limit: z.number().optional().describe(`Max bytes to return (default ${DEFAULT_LIMIT})`),
    }),
    execute: async ({ path, offset = 0, limit = DEFAULT_LIMIT }) => {
      if (!isInsideStorageDir(path, storageDir)) {
        return { error: `Invalid path: "${path}" is outside the offload storage directory (${storageDir}). To read project files or session transcripts, use the file_read tool instead.` };
      }
      if (!existsSync(path)) {
        return { error: `Persisted result not found: ${path}` };
      }
      try {
        const buf = readFileSync(path);
        const total = buf.byteLength;
        const end = Math.min(offset + limit, total);
        const slice = buf.subarray(offset, end);
        const text = new TextDecoder().decode(slice);
        const truncated = end < total;
        return {
          content: text,
          totalBytes: total,
          ...(truncated && {
            truncated: true,
            nextOffset: end,
            hint: `Showing bytes ${offset}-${end} of ${total}. Use offset=${end} to continue.`,
          }),
        };
      } catch (err: any) {
        return { error: err.message };
      }
    },
  });
}
