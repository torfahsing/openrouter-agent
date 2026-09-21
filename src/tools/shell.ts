import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { offloadIfLarge } from '../tool-offload.js';
import { runtimeContext, isCommandAllowed } from '../runtime-context.js';

export const shellSchema = z.object({
  command: z.string().optional().describe('The shell command to execute'),
  cmd: z.string().optional().describe('Alias for command'),
  timeout: z.number().optional().describe('Timeout in seconds (default: 120)'),
});

const executeShell = async ({ command, cmd, timeout = 120 }: { command?: string; cmd?: string; timeout?: number }, ctx: any) => {
  const targetCommand = command || cmd;
  if (!targetCommand) {
    return { error: 'command is required' };
  }
  if (runtimeContext.allowedTools) {
    if (!isCommandAllowed(targetCommand, runtimeContext.allowedTools)) {
      return {
        error: `Execution of command ${JSON.stringify(targetCommand)} is blocked. It does not match any allowed command pattern in allowedTools: ${JSON.stringify(runtimeContext.allowedTools)}`
      };
    }
  }
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/bash';
    const child = spawn(shell, ['-c', targetCommand]);

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
  };

export const shellTool = tool({
  name: 'shell',
  description: 'Execute a shell command in the current working directory and return its output.',
  inputSchema: shellSchema,
  execute: executeShell,
});

export const bashTool = tool({
  name: 'bash',
  description: 'Execute a shell command in the current working directory (alias for shell)',
  inputSchema: shellSchema,
  execute: executeShell,
});

export const runCommandTool = tool({
  name: 'run_command',
  description: 'Execute a shell command in the current working directory (alias for shell)',
  inputSchema: shellSchema,
  execute: executeShell,
});

