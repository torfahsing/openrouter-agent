import { OpenRouter, ModelResult } from '@openrouter/agent';
import type { Item } from '@openrouter/agent';
import { stepCountIs, maxCost } from '@openrouter/agent/stop-conditions';
import type { AgentConfig } from './config.js';
import { tools } from './tools/index.js';
import { compactMessages } from './compaction.js';

// Monkeypatch ModelResult.prototype.pipeAndConsumeStream to provide detailed API error messages
(ModelResult.prototype as any).pipeAndConsumeStream = async function (stream: any, turnNumber: number) {
  const broadcaster = (this as any).turnBroadcaster;
  broadcaster.push({
    type: 'turn.start',
    turnNumber,
    timestamp: Date.now(),
  });
  const consumer = stream.createConsumer();
  let completedResponse: any = null;
  for await (const event of consumer) {
    broadcaster.push(event);
    if (event.type === 'response.completed') {
      completedResponse = event.response;
    }
    if (event.type === 'response.failed') {
      const apiError = event.response?.error;
      let errorMsg = 'Response failed';
      let statusCode: number | undefined;
      if (apiError) {
        errorMsg = `Response failed: [${apiError.code}] ${apiError.message}`;
        if (typeof apiError.code === 'number') {
          statusCode = apiError.code;
        } else if (typeof apiError.code === 'string' && /^\d+$/.test(apiError.code)) {
          statusCode = parseInt(apiError.code, 10);
        }
      } else if ('message' in event) {
        errorMsg = String(event.message);
      }
      const err: any = new Error(errorMsg);
      if (statusCode) err.status = statusCode;
      throw err;
    }
    if (event.type === 'response.incomplete') {
      completedResponse = event.response;
    }
  }
  broadcaster.push({
    type: 'turn.end',
    turnNumber,
    timestamp: Date.now(),
  });
  if (!completedResponse) {
    throw new Error('Follow-up stream ended without a completed response');
  }
  return completedResponse;
};

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string; [key: string]: unknown };

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; callId: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; callId: string; output: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'turn_end' }
  | { type: 'done'; usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null | undefined; durationMs: number };

function filterTools(allTools: typeof tools, allowedTools?: string[]) {
  if (!allowedTools) {
    return allTools;
  }

  const hasShellAllowed = allowedTools.some(
    (pat) =>
      pat === 'Bash' ||
      pat === 'shell' ||
      /^(?:Bash|shell)\(.*\)$/i.test(pat)
  );

  return allTools.filter((t) => {
    const localName = (t as any).function?.name;
    if (localName) {
      if (localName === 'shell') {
        return hasShellAllowed;
      }
      return [
        'file_read',
        'file_write',
        'file_edit',
        'glob',
        'list_dir',
        'grep',
        'openrouter_models',
        'read_persisted_result',
      ].includes(localName);
    }

    const serverType = (t as any).config?.type;
    if (serverType) {
      if (serverType === 'openrouter:web_search') {
        return allowedTools.some(
          (pat) =>
            pat.toLowerCase() === 'websearch' ||
            pat.toLowerCase() === 'openrouter:web_search'
        );
      }
      if (serverType === 'openrouter:web_fetch') {
        return allowedTools.some(
          (pat) =>
            pat.toLowerCase() === 'webfetch' ||
            pat.toLowerCase() === 'openrouter:web_fetch'
        );
      }
      if (serverType === 'openrouter:datetime') {
        return true;
      }
    }

    return false;
  });
}

export async function runAgent(
  config: AgentConfig,
  input: string | ChatMessage[],
  options?: { onEvent?: (event: AgentEvent) => void; signal?: AbortSignal },
) {
  const startedAt = Date.now();
  const client = new OpenRouter({ apiKey: config.apiKey });

  // Structured Logging to stderr for observability
  process.stderr.write(JSON.stringify({ 
    type: 'agent_start', 
    timestamp: new Date().toISOString(), 
    model: config.model 
  }) + '\n');

  let activeInput: string | ChatMessage[] = input;
  
  if (Array.isArray(activeInput) && activeInput.length > 40) {
    activeInput = (await compactMessages(client, activeInput, {
      threshold: 40,
      keepRecent: 10,
    })) as ChatMessage[];
  }

  const instructions = config.systemPrompt.replace('{cwd}', process.cwd());

  const filteredTools = filterTools(tools, config.allowedTools);

  const result = client.callModel({
    model: config.model,
    instructions,
    input: activeInput as string | Item[],
    tools: filteredTools as any,
    stopWhen: [stepCountIs(config.maxSteps), maxCost(config.maxCost)],
  });

  const onAbort = () => result.cancel();
  options?.signal?.addEventListener('abort', onAbort);
  if (options?.signal?.aborted) result.cancel();

  let accumulatedText = '';

  try {
    const callNames = new Map<string, string>();

    const streamText = async () => {
      for await (const delta of result.getTextStream()) {
        if (options?.signal?.aborted) break;
        options?.onEvent?.({ type: 'text', delta });
        accumulatedText += delta;
      }
    };

    const streamToolsAndReasoning = async () => {
      for await (const item of result.getItemsStream()) {
        if (options?.signal?.aborted) break;

        if (item.type === 'function_call') {
          callNames.set(item.callId, item.name);
          if (item.status === 'completed') {
            const args = (() => {
              try { return item.arguments ? JSON.parse(item.arguments) : {}; }
              catch { return {}; }
            })();
            
            // Log tool calls to stderr
            process.stderr.write(JSON.stringify({
              type: 'tool_call',
              timestamp: new Date().toISOString(),
              name: item.name,
              callId: item.callId,
              args,
            }) + '\n');

            options?.onEvent?.({ type: 'tool_call', name: item.name, callId: item.callId, args });
          }
        } else if (item.type === 'function_call_output') {
          const out = typeof item.output === 'string' ? item.output : JSON.stringify(item.output);
          const preview = out.length > 200 ? out.slice(0, 200) + '...' : out;
          
          // Log tool results to stderr
          process.stderr.write(JSON.stringify({
            type: 'tool_result',
            timestamp: new Date().toISOString(),
            name: callNames.get(item.callId) ?? 'unknown',
            callId: item.callId,
            outputSummary: preview,
          }) + '\n');

          options?.onEvent?.({
            type: 'tool_result',
            name: callNames.get(item.callId) ?? 'unknown',
            callId: item.callId,
            output: out,
          });
          options?.onEvent?.({ type: 'turn_end' });
        } else if (item.type === 'reasoning') {
          const text = item.summary?.map((s: { text: string }) => s.text).join('') ?? '';
          if (text) {
            options?.onEvent?.({ type: 'reasoning', delta: text });
          }
        }
      }
    };

    await Promise.all([streamText(), streamToolsAndReasoning()]);

    const response = await result.getResponse();
    const durationMs = Date.now() - startedAt;
    const text = accumulatedText || (response.outputText ?? '');
    
    // Log execution termination to stderr
    process.stderr.write(JSON.stringify({
      type: 'agent_end',
      timestamp: new Date().toISOString(),
      durationMs,
      usage: response.usage,
    }) + '\n');

    options?.onEvent?.({ type: 'done', usage: response.usage, durationMs });
    return { text, usage: response.usage, output: response.output, durationMs };
  } catch (err: any) {
    process.stderr.write(JSON.stringify({
      type: 'error',
      timestamp: new Date().toISOString(),
      message: err.message,
    }) + '\n');
    throw err;
  } finally {
    options?.signal?.removeEventListener('abort', onAbort);
  }
}

const MUTATING_TOOLS = new Set(['file_write', 'file_edit', 'shell', 'Bash']);

export async function runAgentWithRetry(
  config: AgentConfig,
  input: string | ChatMessage[],
  options?: { onEvent?: (event: AgentEvent) => void; signal?: AbortSignal; maxRetries?: number },
) {
  for (let attempt = 0, max = options?.maxRetries ?? 3; attempt <= max; attempt++) {
    let mutatingToolCallsMade = 0;
    const wrappedOptions = {
      ...options,
      onEvent: (event: AgentEvent) => {
        if (event.type === 'tool_call' && MUTATING_TOOLS.has(event.name)) {
          mutatingToolCallsMade++;
        }
        options?.onEvent?.(event);
      },
    };
    try {
      return await runAgent(config, input, wrappedOptions);
    } catch (err: any) {
      const s = err?.status ?? err?.statusCode;
      const msg = err?.message ? String(err.message) : '';
      const isTransientMsg = /Provider returned error|rate limit|overloaded|timeout|502|503|504|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
      const retryable = s === 429 || (s >= 500 && s < 600) || isTransientMsg;
      if (!retryable || attempt === max || mutatingToolCallsMade > 0) throw err;
      
      const delay = Math.min(1000 * 2 ** attempt, 30000);
      process.stderr.write(JSON.stringify({
        type: 'retry_wait',
        timestamp: new Date().toISOString(),
        attempt: attempt + 1,
        delayMs: delay,
        error: err.message,
      }) + '\n');
      
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}
