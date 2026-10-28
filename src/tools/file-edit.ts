import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const singleEditItemSchema = z.object({
  old_text: z.string().optional().describe('The exact text to find and replace'),
  oldText: z.string().optional().describe('Alias for old_text'),
  target: z.string().optional().describe('Alias for old_text'),
  old: z.string().optional().describe('Alias for old_text'),
  new_text: z.string().optional().describe('The new text to replace it with'),
  newText: z.string().optional().describe('Alias for new_text'),
  replacement: z.string().optional().describe('Alias for new_text'),
  new: z.string().optional().describe('Alias for new_text'),
});

export const fileEditSchema = z.object({
  path: z.string().optional().describe('Absolute path to the file to edit'),
  file_path: z.string().optional().describe('Alias for path'),
  edits: z.array(singleEditItemSchema).optional().describe('List of search-and-replace edits to apply'),
  old_text: z.string().optional().describe('For single edit: exact text to find and replace'),
  oldText: z.string().optional().describe('Alias for old_text'),
  target: z.string().optional().describe('Alias for old_text'),
  old: z.string().optional().describe('Alias for old_text'),
  new_text: z.string().optional().describe('For single edit: new text to replace it with'),
  newText: z.string().optional().describe('Alias for new_text'),
  replacement: z.string().optional().describe('Alias for new_text'),
  new: z.string().optional().describe('Alias for new_text'),
});

export const executeFileEdit = async (params: {
  path?: string;
  file_path?: string;
  edits?: any[];
  old_text?: string;
  oldText?: string;
  target?: string;
  old?: string;
  new_text?: string;
  newText?: string;
  replacement?: string;
  new?: string;
}) => {
  const targetPath = params.path || params.file_path;
  if (!targetPath) {
    return { error: 'path is required' };
  }
  if (!existsSync(targetPath)) {
    return { error: `File not found: ${targetPath}` };
  }

  const rawEdits: any[] = [];
  if (Array.isArray(params.edits) && params.edits.length > 0) {
    rawEdits.push(...params.edits);
  }
  const topOld = params.old_text ?? params.oldText ?? params.target ?? params.old;
  const topNew = params.new_text ?? params.newText ?? params.replacement ?? params.new;
  if (topOld !== undefined && topNew !== undefined) {
    rawEdits.push({ old_text: topOld, new_text: topNew });
  }

  if (rawEdits.length === 0) {
    return { error: 'No edits specified. Provide edits array or old_text/new_text.' };
  }

  const normalizedEdits = rawEdits.map((e) => ({
    old_text: e.old_text ?? e.oldText ?? e.target ?? e.old,
    new_text: e.new_text ?? e.newText ?? e.replacement ?? e.new ?? '',
  }));

  for (const edit of normalizedEdits) {
    if (typeof edit.old_text !== 'string') {
      return { error: 'Each edit must specify old_text (or oldText/target).' };
    }
  }

  try {
    const original = readFileSync(targetPath, 'utf-8');
    let current = original;
    let diffOutput = '';

    for (const edit of normalizedEdits) {
      const index = current.indexOf(edit.old_text);
      if (index === -1) {
        return { error: `Could not find exact match for edit in ${targetPath}. Make sure whitespace and characters match exactly.` };
      }
      const secondIndex = current.indexOf(edit.old_text, index + edit.old_text.length);
      if (secondIndex !== -1) {
        return { error: `Ambiguous edit in ${targetPath}: the text to replace appears multiple times in the file. Provide more context around the block to make it unique.` };
      }
      current = current.slice(0, index) + edit.new_text + current.slice(index + edit.old_text.length);
      diffOutput += `\n--- original\n${edit.old_text}\n+++ updated\n${edit.new_text}\n`;
    }

    writeFileSync(targetPath, current, 'utf-8');

    return {
      edited: true,
      path: targetPath,
      diff: diffOutput.trim(),
    };
  } catch (err: any) {
    return { error: err.message };
  }
};

export const fileEditTool = tool({
  name: 'file_edit',
  description: 'Apply search-and-replace edits to a file. Each edit must specify the precise old_text to be replaced and the new_text to replace it with. The old_text must match exactly one unique section of the file.',
  inputSchema: fileEditSchema,
  execute: executeFileEdit,
});

export const editFileTool = tool({
  name: 'edit_file',
  description: 'Apply search-and-replace edits to a file (alias for file_edit)',
  inputSchema: fileEditSchema,
  execute: executeFileEdit,
});

export const editTool = tool({
  name: 'edit',
  description: 'Apply search-and-replace edits to a file (alias for file_edit)',
  inputSchema: fileEditSchema,
  execute: executeFileEdit,
});

