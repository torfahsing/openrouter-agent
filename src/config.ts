import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function positiveNumber(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive number, got: ${JSON.stringify(raw)}`);
  }
  return n;
}

export interface AgentConfig {
  apiKey: string;
  model: string;
  name: string;
  systemPrompt: string;
  maxSteps: number;
  maxCost: number;
  sessionDir: string;
  sessionEnabled: boolean;
  outputMode: 'text' | 'json' | 'quiet';
  allowedTools?: string[];
  permissionMode?: string;
}

const DEFAULTS: AgentConfig = {
  apiKey: '',
  model: '',
  name: 'OpenRouter Headless Agent',
  systemPrompt: [
    'You are a coding assistant with access to tools for reading, writing, editing, and searching files, and running shell commands.',
    '',
    'Current working directory: {cwd}',
    '',
    'Guidelines:',
    '- Use your tools proactively. Explore the codebase to find answers instead of asking the user.',
    '- Keep working until the task is fully resolved before responding.',
    '- Do not guess or make up information — use your tools to verify.',
    '- Be concise and direct.',
    '- Show file paths clearly when working with files.',
    '- Prefer grep and glob tools over shell commands for file search.',
    '- When editing code, make minimal targeted changes consistent with the existing style.',
  ].join('\n'),
  maxSteps: 60,
  maxCost: 1.0,
  sessionDir: '.sessions',
  sessionEnabled: true,
  outputMode: 'text',
};

export function loadConfig(overrides: Partial<AgentConfig> = {}, opts?: { skipApiKey?: boolean }): AgentConfig {
  let config = { ...DEFAULTS };

  const configPath = resolve('agent.config.json');
  if (existsSync(configPath)) {
    try {
      const file = JSON.parse(readFileSync(configPath, 'utf-8'));
      config = { ...config, ...file };
    } catch {
      // Ignored if config file is invalid or missing
    }
  }

  if (process.env.OPENROUTER_API_KEY) config.apiKey = process.env.OPENROUTER_API_KEY;
  if (process.env.AGENT_MODEL) config.model = process.env.AGENT_MODEL;
  if (process.env.AGENT_MAX_STEPS) config.maxSteps = positiveNumber('AGENT_MAX_STEPS', process.env.AGENT_MAX_STEPS);
  if (process.env.AGENT_MAX_COST) config.maxCost = positiveNumber('AGENT_MAX_COST', process.env.AGENT_MAX_COST);

  config = { ...config, ...overrides };
  
  if (!config.apiKey && !opts?.skipApiKey) {
    throw new Error('OPENROUTER_API_KEY is required in environment.');
  }
  if (!config.model) {
    throw new Error('Model must be specified via --model (-m) or AGENT_MODEL environment variable.');
  }

  return config;
}
