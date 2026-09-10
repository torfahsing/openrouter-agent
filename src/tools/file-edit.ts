import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const fileEditTool = tool({
  name: 'file_edit',
  description: 'Apply search-and-replace edits to a file. Each edit must specify the precise old_text to be replaced and the new_text to replace it with. The old_text must match exactly one unique section of the file.',
  inputSchema: z.object({
    path: z.string().describe('Absolute path to the file to edit'),
    edits: z.array(z.object({
      old_text: z.string().describe('The exact text to find and replace'),
      new_text: z.string().describe('The new text to replace it with'),
    })).describe('List of search-and-replace edits to apply'),
  }),
  execute: async ({ path, edits }) => {
    if (!existsSync(path)) {
      return { error: `File not found: ${path}` };
    }

    try {
      const original = readFileSync(path, 'utf-8');
      let current = original;
      let diffOutput = '';

      for (const edit of edits) {
        const index = current.indexOf(edit.old_text);
        if (index === -1) {
          return { error: `Could not find exact match for edit in ${path}. Make sure whitespace and characters match exactly.` };
        }
        const secondIndex = current.indexOf(edit.old_text, index + edit.old_text.length);
        if (secondIndex !== -1) {
          return { error: `Ambiguous edit in ${path}: the text to replace appears multiple times in the file. Provide more context around the block to make it unique.` };
        }
        current = current.slice(0, index) + edit.new_text + current.slice(index + edit.old_text.length);
        diffOutput += `\n--- original\n${edit.old_text}\n+++ updated\n${edit.new_text}\n`;
      }

      writeFileSync(path, current, 'utf-8');

      return {
        edited: true,
        path,
        diff: diffOutput.trim(),
      };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});
