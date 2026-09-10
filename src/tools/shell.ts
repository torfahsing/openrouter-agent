import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { offloadIfLarge } from '../tool-offload.js';
import { runtimeContext, isCommandAllowed } from '../runtime-context.js';

export const shellTool = tool({
  name: 'shell',
  description: 'Execute a shell command in the current working directory and return its output.',
  inputSchema: z.object({
    command: z.string().describe('The shell command to execute'),
    timeout: z.number().optional().describe('Timeout in seconds (default: 120)'),
  }),
  execute: async ({ command, timeout = 120 }, ctx) => {
    if (runtimeContext.allowedTools) {
      if (!isCommandAllowed(command, runtimeContext.allowedTools)) {
        return {
          error: `Execution of command ${JSON.stringify(command)} is blocked. It does not match any allowed command pattern in allowedTools: ${JSON.stringify(runtimeContext.allowedTools)}`
        };
      }
    }
    return new Promise((resolve) => {
      const shell = process.env.SHELL || '/bin/bash';
      const child = spawn(shell, ['-c', command]);

      let output = '';
      let errorOutput = '';

      if (!child.stdout || !child.stderr) {
        resolve({ error: 'Failed to initialize process streams.' });
        return;
      }

      child.stdout.on('data', (data: Buffer | string) => {
        output += data.toString();
      });

      child.stderr.on('data', (data: Buffer | string) => {
        errorOutput += data.toString();
      });

      const timer = setTimeout(() => {
        child.kill();
        const finalOutput = `[Timeout of ${timeout}s exceeded]\n${output}\n${errorOutput}`;
        resolve(offloadIfLarge({ output: finalOutput, exitCode: -1, timedOut: true }, ctx));
      }, timeout * 1000);

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        const combined = output + errorOutput;
        resolve(offloadIfLarge({ output: combined, exitCode: code ?? 0 }, ctx));
      });

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        resolve({ error: `Failed to start process: ${err.message}` });
      });
    });
  },
});
