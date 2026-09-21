import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';

const DEFAULT_LINE_LIMIT = 2000;
const MAX_LINE_CHARS = 2000;

export const fileReadSchema = z.object({
  path: z.string().optional().describe('Absolute path to the file'),
  file_path: z.string().optional().describe('Alias for path'),
  offset: z.number().optional().describe('Start reading from this line (1-indexed)'),
  limit: z.number().optional().describe(`Maximum lines to return (default ${DEFAULT_LINE_LIMIT})`),
});

export const executeFileRead = async ({ path, file_path, offset = 1, limit = DEFAULT_LINE_LIMIT }: { path?: string; file_path?: string; offset?: number; limit?: number }) => {
  const targetPath = path || file_path;
  if (!targetPath) {
    return { error: 'path is required' };
  }
  if (!existsSync(targetPath)) {
    return { error: `File not found: ${targetPath}` };
  }

    // Image detection
    const ext = extname(path).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
      try {
        const buf = readFileSync(path);
        const data = buf.toString('base64');
        const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : `image/${ext.slice(1)}`;
        return { type: 'image', data, mimeType };
      } catch (err: any) {
        return { error: `Failed to read image: ${err.message}` };
      }
    }

    try {
      const content = readFileSync(path, 'utf-8');
      const lines = content.split('\n');
      const start = offset - 1;
      const end = Math.min(start + limit, lines.length);
      
      let longLines = 0;
      const slice = lines.slice(start, end).map((line) => {
        if (line.length <= MAX_LINE_CHARS) return line;
        longLines++;
        return line.slice(0, MAX_LINE_CHARS) + `… [line truncated, ${line.length - MAX_LINE_CHARS} chars dropped]`;
      });

      const tailTruncated = end < lines.length;
      const truncated = tailTruncated || longLines > 0;
      const hintParts: string[] = [`Showing lines ${start + 1}-${end} of ${lines.length}.`];
      
      if (tailTruncated) hintParts.push(`Use offset=${end + 1} to continue.`);
      if (longLines > 0) {
        hintParts.push(`${longLines} line(s) exceeded ${MAX_LINE_CHARS} chars and were per-line truncated; use grep to fetch content from those lines.`);
      }

      return {
        content: slice.join('\n'),
        totalLines: lines.length,
        ...(truncated && {
          truncated: true,
          ...(tailTruncated && { nextOffset: end + 1 }),
          hint: hintParts.join(' '),
        }),
      };
    } catch (err: any) {
      return { error: err.message };
    }
  };

export const fileReadTool = tool({
  name: 'file_read',
  description:
    'Read the contents of a file. Output is capped at 2000 lines by default (use offset/limit to paginate) and any line longer than 2000 characters is truncated. When the response is truncated, the hint field tells you how to continue.',
  inputSchema: fileReadSchema,
  execute: executeFileRead,
});

export const readTool = tool({
  name: 'read',
  description: 'Read the contents of a file (alias for file_read)',
  inputSchema: fileReadSchema,
  execute: executeFileRead,
});

export const viewFileTool = tool({
  name: 'view_file',
  description: 'Read the contents of a file (alias for file_read)',
  inputSchema: fileReadSchema,
  execute: executeFileRead,
});

