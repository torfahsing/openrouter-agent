#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { loadConfig, type AgentConfig } from './config.js';
import { runAgentWithRetry, type AgentEvent } from './agent.js';
import { initSessionDir, saveMessage, newSessionPath, loadSession } from './session.js';
import { runtimeContext } from './runtime-context.js';

// Helper to read piped stdin input in Node.js
async function getStdinText(): Promise<string> {
  return new Promise((resolve, reject) => {
    let content = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      content += chunk;
    });
    process.stdin.on('end', () => {
      resolve(content);
    });
    process.stdin.on('error', (err) => {
      reject(err);
    });
  });
}

// Preprocess argv to normalize --allowedTools/--allowed-tools multi-values
const originalArgv = process.argv.slice(2);
const argv: string[] = [];
let collectingAllowedTools = false;

for (const arg of originalArgv) {
  if (arg === '--allowedTools' || arg === '--allowed-tools') {
    collectingAllowedTools = true;
    continue;
  }
  
  if (collectingAllowedTools) {
    if (arg.startsWith('-')) {
      collectingAllowedTools = false;
      argv.push(arg);
    } else {
      argv.push('--allowedTools', arg);
    }
  } else {
    argv.push(arg);
  }
}

const preMode: 'text' | 'json' | 'quiet' =
  argv.includes('--json') || argv.includes('-j') ? 'json' :
  argv.includes('--quiet') || argv.includes('-q') ? 'quiet' : 'text';

function reportError(err: any): never {
  const message = err?.message ?? String(err);
  if (preMode === 'json') {
    process.stdout.write(JSON.stringify({ type: 'error', message }) + '\n');
  } else if (preMode !== 'quiet') {
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exit(1);
}

let values: Record<string, any>;
let positionals: string[];
try {
  const parsed = parseArgs({
    args: argv,
    options: {
      prompt:            { type: 'string',  short: 'p' },
      json:              { type: 'boolean', short: 'j', default: false },
      quiet:             { type: 'boolean', short: 'q', default: false },
      session:           { type: 'string',  short: 's' },
      'no-session':      { type: 'boolean', default: false },
      model:             { type: 'string',  short: 'm' },
      'max-steps':       { type: 'string' },
      'max-cost':        { type: 'string' },
      'output-schema':   { type: 'string' },
      allowedTools:      { type: 'string',  multiple: true },
      'permission-mode': { type: 'string' },
      help:              { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  values = parsed.values;
  positionals = parsed.positionals;
} catch (err) {
  reportError(err);
}

if (values.help) {
  console.log(`Usage: openrouter-agent [options] [prompt]

Options:
  -p, --prompt <text>       Prompt to send to the agent
  -j, --json                Output NDJSON event stream instead of text
  -q, --quiet               No output; exit 0 on success, 1 on error
      --no-session          Disable session persistence for this run
  -m, --model <model>       Override the model (e.g. google/gemini-2.5-pro)
      --max-steps <n>       Maximum number of agent steps
      --max-cost <n>        Maximum cost in dollars
      --output-schema <f>   Path to a JSON Schema file to validate output
  -h, --help                Show this help message

Prompt sources (in priority order):
  1. --prompt flag
  2. Positional argument
  3. Piped stdin (when stdin is not a TTY)

Examples:
  openrouter-agent --prompt "List all TypeScript files"
  openrouter-agent "What is 2+2?"
  echo "Summarize this" | openrouter-agent
`);
  process.exit(0);
}

let prompt = values.prompt ?? positionals[0];

if (!prompt && !process.stdin.isTTY) {
  prompt = await getStdinText();
  prompt = prompt.trim();
}

if (!prompt) {
  console.error('Error: no prompt provided. Use --prompt, a positional arg, or pipe to stdin.');
  process.exit(1);
}

const overrides: Partial<AgentConfig> = {};
if (values.model) overrides.model = values.model;
if (values.allowedTools) overrides.allowedTools = values.allowedTools;
if (values['permission-mode']) overrides.permissionMode = values['permission-mode'];

const config = loadConfig(
  overrides,
  { skipApiKey: false }
);

if (config.allowedTools) {
  runtimeContext.allowedTools = config.allowedTools;
}
if (config.permissionMode) {
  runtimeContext.permissionMode = config.permissionMode;
}
if (values['max-steps']) {
  const n = Number(values['max-steps']);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--max-steps must be a positive number, got: ${values['max-steps']}`);
  }
  config.maxSteps = n;
}
if (values['max-cost']) {
  const n = Number(values['max-cost']);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--max-cost must be a positive number, got: ${values['max-cost']}`);
  }
  config.maxCost = n;
}

let outputSchema: Record<string, unknown> | undefined;
if (values['output-schema']) {
  try {
    const raw = readFileSync(values['output-schema'], 'utf-8');
    outputSchema = JSON.parse(raw);
  } catch (err: any) {
    console.error(`Error: could not load output schema: ${err.message}`);
    process.exit(1);
  }
}

let sessionPath: string | undefined;
let inputPayload: string | any[] = prompt;

if (typeof values.session === 'string') {
  sessionPath = values.session;
  const history = await loadSession(sessionPath);
  if (history.length > 0) {
    inputPayload = history;
  }
  if (prompt) {
    saveMessage(sessionPath, { role: 'user', content: prompt });
  }
} else if (config.sessionEnabled && !values['no-session']) {
  initSessionDir(config.sessionDir);
  sessionPath = newSessionPath(config.sessionDir);
  saveMessage(sessionPath, { role: 'user', content: prompt });
}

try {
  let hasEmittedText = false;
  const result = await runAgentWithRetry(config, inputPayload, {
    onEvent: (event: AgentEvent) => {
      if (values.json) {
        process.stdout.write(JSON.stringify(event) + '\n');
      } else if (!values.quiet) {
        if (event.type === 'text') {
          process.stdout.write(event.delta);
          hasEmittedText = true;
        } else if (event.type === 'turn_end' && hasEmittedText) {
          process.stdout.write('\n');
        }
      }
    },
  });

  if (!values.json && !values.quiet) {
    process.stdout.write('\n');
  }

  if (sessionPath) {
    saveMessage(sessionPath, { role: 'assistant', content: result.text });
  }

  if (outputSchema) {
    const { default: Ajv } = await import('ajv');
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(outputSchema);

    const extractJson = (text: string): string => {
      const trimmed = text.trim();
      const fence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (fence) return fence[1].trim();
      const objStart = trimmed.indexOf('{');
      const objEnd = trimmed.lastIndexOf('}');
      const arrStart = trimmed.indexOf('[');
      const arrEnd = trimmed.lastIndexOf(']');
      const useArr = arrStart !== -1 && (objStart === -1 || arrStart < objStart);
      const start = useArr ? arrStart : objStart;
      const end = useArr ? arrEnd : objEnd;
      if (start !== -1 && end > start) return trimmed.slice(start, end + 1);
      return trimmed;
    };

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(result.text));
    } catch {
      console.error('Error: agent output is not valid JSON (output-schema was specified)');
      process.exit(2);
    }
    if (!validate(parsed)) {
      console.error(`Error: agent output failed schema validation: ${ajv.errorsText(validate.errors)}`);
      process.exit(2);
    }
  }

  process.exit(0);
} catch (err: any) {
  if (!values.quiet) {
    if (values.json) {
      process.stdout.write(JSON.stringify({ type: 'error', message: err.message }) + '\n');
    } else {
      console.error(`Error: ${err.message}`);
    }
  }
  process.exit(1);
}
