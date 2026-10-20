import { OpenRouter, ModelResult } from '@openrouter/agent';
import type { Item } from '@openrouter/agent';
import { stepCountIs, maxCost } from '@openrouter/agent/stop-conditions';
import type { AgentConfig } from './config.js';
import { tools } from './tools/index.js';
import { compactMessages } from './compaction.js';
import { pruneHistoricalToolOutputs } from './history-pruner.js';

import { extractOpenRouterErrorMessage } from './error.js';

// Monkeypatch ModelResult.prototype.makeFollowupRequest to bound multi-turn conversation payload
const originalMakeFollowupRequest = (ModelResult.prototype as any).makeFollowupRequest;
if (typeof originalMakeFollowupRequest === 'function') {
  (ModelResult.prototype as any).makeFollowupRequest = async function (
    currentResponse: any,
    toolResults: any,
    turnNumber: number,
  ) {
    // 1. Cap any oversized outputs in the incoming toolResults for the current turn
    if (Array.isArray(toolResults)) {
      for (const res of toolResults) {
        if (res && res.type === 'function_call_output' && typeof res.output === 'string') {
          if (res.output.length > 40_000) {
            const head = res.output.slice(0, 15_000);
            const tail = res.output.slice(-15_000);
            res.output = `${head}\n\n... [output truncated: ${res.output.length - 30_000} chars omitted to stay within context limits] ...\n\n${tail}`;
          }
        }
      }
    }

    // 2. Prune historical tool outputs from earlier turns
    if (Array.isArray(this.resolvedRequest?.input)) {
      this.resolvedRequest.input = pruneHistoricalToolOutputs(this.resolvedRequest.input);
    }

    return originalMakeFollowupRequest.call(this, currentResponse, toolResults, turnNumber);
  };
}

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
        errorMsg = extractOpenRouterErrorMessage({ error: apiError });
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
      err.error = apiError;
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

export interface DoneUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  /** Exact USD cost reported by the upstream API/provider, when available. */
  cost?: number | null;
  costDetails?: {
    upstreamInferenceCost?: number | null | undefined;
    upstreamInferenceInputCost?: number;
    upstreamInferenceOutputCost?: number;
  };
}

/**
 * Normalize raw usage data (either the SDK `SessionUsageTotals` from
 * `getUsage()` or the final response's `Usage`) to the stable `DoneUsage`
 * shape emitted on the `done` NDJSON event. Unknown extra fields (such as
 * `modelCalls`) are intentionally dropped, and `cost` is preserved only when
 * the upstream reported an actual numeric value.
 */
export function normalizeUsage(raw: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  cost?: number | null | undefined;
  costDetails?: DoneUsage['costDetails'];
  [key: string]: unknown;
} | null | undefined): DoneUsage | null {
  if (!raw) return null;
  const usage: DoneUsage = {
    ...(raw.inputTokens !== undefined ? { inputTokens: raw.inputTokens } : {}),
    ...(raw.outputTokens !== undefined ? { outputTokens: raw.outputTokens } : {}),
    ...(raw.totalTokens !== undefined ? { totalTokens: raw.totalTokens } : {}),
    ...(raw.cachedTokens !== undefined ? { cachedTokens: raw.cachedTokens } : {}),
    ...(raw.reasoningTokens !== undefined ? { reasoningTokens: raw.reasoningTokens } : {}),
    ...(typeof raw.cost === 'number' ? { cost: raw.cost } : {}),
    ...(raw.costDetails ? { costDetails: raw.costDetails } : {}),
  };
  return usage;
}

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; callId: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; callId: string; output: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'turn_end' }
  | { type: 'done'; usage: DoneUsage | null | undefined; durationMs: number };

export function filterTools(allTools: typeof tools, allowedTools?: string[]) {
  if (!allowedTools) {
    return allTools;
  }

  if (allowedTools.includes('none') || (allowedTools.length === 1 && allowedTools[0] === '')) {
    return [];
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
      if (['shell', 'bash', 'run_command'].includes(localName)) {
        return hasShellAllowed;
      }
      if (localName === 'read_persisted_result') {
        return true;
      }
      if (['file_read', 'read_file', 'read', 'view_file'].includes(localName)) {
        return (
          allowedTools.includes('file_read') ||
          allowedTools.includes('read_file') ||
          allowedTools.includes('read')
        );
      }
      if (['file_write', 'write_file', 'write'].includes(localName)) {
        return (
          allowedTools.includes('file_write') ||
          allowedTools.includes('write_file') ||
          allowedTools.includes('write')
        );
      }
      if (['file_edit', 'edit_file', 'edit'].includes(localName)) {
        return (
          allowedTools.includes('file_edit') ||
          allowedTools.includes('edit_file') ||
          allowedTools.includes('edit')
        );
      }
      if (['list_dir', 'list_files', 'ls'].includes(localName)) {
        return (
          allowedTools.includes('list_dir') ||
          allowedTools.includes('list_files') ||
          allowedTools.includes('ls')
        );
      }
      return allowedTools.includes(localName);
    }

    const serverType = (t as any).config?.type;
    if (serverType) {
      if (serverType === 'openrouter:datetime') {
        return allowedTools.some(
          (pat) =>
            pat.toLowerCase() === 'datetime' ||
            pat.toLowerCase() === 'openrouter:datetime'
        );
      }
      if (serverType === 'openrouter:web_search') {
        return allowedTools.some(
          (pat) =>
            pat.toLowerCase() === 'websearch' ||
            pat.toLowerCase() === 'web_search' ||
            pat.toLowerCase() === 'openrouter:web_search'
        );
      }
      if (serverType === 'openrouter:web_fetch') {
        return allowedTools.some(
          (pat) =>
            pat.toLowerCase() === 'webfetch' ||
            pat.toLowerCase() === 'web_fetch' ||
            pat.toLowerCase() === 'openrouter:web_fetch'
        );
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

  let activeInput: string | ChatMessage[] = input;

  if (typeof activeInput === 'string' && activeInput.length > 500_000) {
    activeInput =
      activeInput.slice(0, 200_000) +
      '\n\n... [initial prompt truncated to stay within context limits] ...\n\n' +
      activeInput.slice(-200_000);
  } else if (Array.isArray(activeInput)) {
    activeInput = pruneHistoricalToolOutputs(activeInput as any[]);
  }

  if (Array.isArray(activeInput) && activeInput.length > 40) {
    activeInput = (await compactMessages(client, activeInput, {
      threshold: 40,
      keepRecent: 10,
    })) as ChatMessage[];
  }

  const filteredTools = filterTools(tools, config.allowedTools);

  const ALIAS_TOOLS = new Set([
    'read_file', 'read', 'view_file',
    'write_file', 'write',
    'edit_file', 'edit',
    'list_files', 'ls',
    'bash', 'run_command',
    'read_persisted_result',
  ]);

  const primaryToolNames = Array.from(new Set(
    filteredTools
      .map((t: any) => t.function?.name ?? t.config?.type)
      .filter((n: string) => n && !ALIAS_TOOLS.has(n))
  ));
  const toolHint = primaryToolNames.length > 0
    ? `\n\nAvailable tools: ${primaryToolNames.join(', ')}`
    : '';
  const schemaHint = config.outputSchema
    ? `\n\nImportant: Your final answer MUST strictly conform to this JSON schema:\n${JSON.stringify(config.outputSchema, null, 2)}\nReturn ONLY the JSON object conforming to the schema.`
    : '';
  const instructions = config.systemPrompt.replace('{cwd}', process.cwd()) + toolHint + schemaHint;

  const callModelParams: any = {
    model: config.model,
    instructions,
    input: activeInput as string | Item[],
    tools: filteredTools as any,
    stopWhen: [stepCountIs(config.maxSteps), maxCost(config.maxCost)],
  };

  const result = client.callModel(callModelParams);

function detectRepetitionLoop(text: string, minCycleLen = 15, maxCycleLen = 500, minRepeats = 3): boolean {
  if (text.length < minCycleLen * minRepeats) return false;
  const maxL = Math.min(maxCycleLen, Math.floor(text.length / minRepeats));
  for (let L = minCycleLen; L <= maxL; L++) {
    const candidate = text.slice(-L);
    let repeats = 1;
    let offset = text.length - L;
    while (offset >= L && text.slice(offset - L, offset) === candidate) {
      repeats++;
      offset -= L;
      if (repeats >= minRepeats) {
        return true;
      }
    }
  }
  return false;
}

  const onAbort = () => result.cancel();
  options?.signal?.addEventListener('abort', onAbort);
  if (options?.signal?.aborted) result.cancel();

  let accumulatedText = '';

  try {
    const callNames = new Map<string, string>();
    const executedCallIds = new Set<string>();

    const streamText = async () => {
      for await (const delta of result.getTextStream()) {
        if (options?.signal?.aborted) break;
        accumulatedText += delta;
        if (detectRepetitionLoop(accumulatedText)) {
          console.error('[agent] Repetition degeneration loop detected in model output, aborting turn');
          result.cancel();
          throw new Error('Model output entered infinite repetition loop');
        }
        options?.onEvent?.({ type: 'text', delta });
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
            
            options?.onEvent?.({ type: 'tool_call', name: item.name, callId: item.callId, args });
          }
        } else if (item.type === 'function_call_output') {
          executedCallIds.add(item.callId);
          const out = typeof item.output === 'string' ? item.output : JSON.stringify(item.output);

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

    const unexecuted = Array.from(callNames.entries()).filter(([callId]) => !executedCallIds.has(callId));
    if (unexecuted.length > 0) {
      const names = unexecuted.map(([_, name]) => name).join(', ');
      throw new Error(`Agent execution halted prematurely with unexecuted tool call(s): ${names}`);
    }

    const response = await result.getResponse();
    const durationMs = Date.now() - startedAt;
    const text = accumulatedText || (response.outputText ?? '');

    // Aggregate usage across EVERY model call this run made (each tool-round
    // follow-up is billed separately and the final round alone omits them).
    // `getUsage()` never rejects, but guard anyway so a telemetry failure can
    // never mask a completed run — fall back to the final response's usage.
    let sessionUsage: DoneUsage | null = normalizeUsage(response.usage);
    try {
      const totals = await result.getUsage();
      if (totals && (totals.inputTokens !== undefined || totals.outputTokens !== undefined || typeof totals.cost === 'number')) {
        sessionUsage = normalizeUsage(totals);
      }
    } catch {
      // keep response.usage as fallback
    }

    options?.onEvent?.({ type: 'done', usage: sessionUsage, durationMs });
    return { text, usage: sessionUsage, output: response.output, durationMs };
  } catch (err: any) {
    const formattedMessage = extractOpenRouterErrorMessage(err);
    const enrichedErr = new Error(formattedMessage);
    enrichedErr.name = err.name || 'OpenRouterError';
    (enrichedErr as any).status = err?.status ?? err?.statusCode ?? err?.error?.code;
    (enrichedErr as any).statusCode = (enrichedErr as any).status;
    (enrichedErr as any).error = err.error ?? err.data$?.error;
    throw enrichedErr;
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
      const isTransientMsg = /Provider returned error|rate limit|rate-limited|overloaded|timeout|502|503|504|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
      const retryable = s === 429 || (s >= 500 && s < 600) || isTransientMsg;
      if (!retryable || attempt === max || mutatingToolCallsMade > 0) throw err;
      
      const delay = Math.min(1000 * 2 ** attempt, 30000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}
