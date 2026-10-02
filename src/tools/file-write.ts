import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const fileWriteSchema = z.object({
  path: z.string().optional().describe('Absolute path to the file to create/overwrite'),
  file_path: z.string().optional().describe('Alias for path'),
  content: z.string().describe('Content to write to the file'),
});

export const executeFileWrite = async ({ path, file_path, content }: { path?: string; file_path?: string; content: string }) => {
  const targetPath = path || file_path;
  if (!targetPath) {
    return { error: 'path is required' };
  }
  try {
    const dir = dirname(targetPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(targetPath, content, 'utf-8');
    return { written: true, path: targetPath };
  } catch (err: any) {
    return { error: err.message };
  }
};

export const fileWriteTool = tool({
  name: 'file_write',
  description: 'Write content to a file, creating it and parent directories if needed.',
  inputSchema: fileWriteSchema,
  execute: executeFileWrite,
});

export const writeFileTool = tool({
  name: 'write_file',
  description: 'Write content to a file (alias for file_write)',
  inputSchema: fileWriteSchema,
  execute: executeFileWrite,
});

export const writeTool = tool({
  name: 'write',
  description: 'Write content to a file (alias for file_write)',
  inputSchema: fileWriteSchema,
  execute: executeFileWrite,
});
