import { describe, expect, it, mock } from 'bun:test';
import * as openrouterAgentActual from '@openrouter/agent';
import {
  ABORT_USAGE_TIMEOUT_MS,
  sanitizeUsage,
  getUsageBestEffort,
  runAgent,
  type AgentEvent,
  type DoneUsage,
} from '../agent';
import type { AgentConfig } from '../config';

// ---------------------------------------------------------------------------
// Mock the SDK's OpenRouter client so runAgent's `client.callModel(...)` is
// driven by a controllable fake `result` (the object exposing the streams,
// `cancel()` and `getUsage()`).
// ---------------------------------------------------------------------------

let currentFakeResult: any = null;

class FakeOpenRouter {
  constructor(_opts: { apiKey: string }) {}
  callModel(_request: unknown, _options?: unknown) {
    return currentFakeResult;
  }
}

mock.module('@openrouter/agent', () => ({
  ...openrouterAgentActual,
  OpenRouter: FakeOpenRouter,
}));

// ---------------------------------------------------------------------------
// sanitizeUsage — emit-safe clamping for the abort path
// ---------------------------------------------------------------------------

describe('sanitizeUsage', () => {
  it('keeps valid partial usage and the exact USD cost', () => {
    const result = sanitizeUsage({
      inputTokens: 194,
      outputTokens: 2,
      totalTokens: 196,
      cost: 0.000095,
    });
    expect(result).toEqual({
      inputTokens: 194,
      outputTokens: 2,
      totalTokens: 196,
      cost: 0.000095,
    } satisfies DoneUsage);
  });

  it('defaults missing token counts to 0', () => {
    const result = sanitizeUsage({ cost: 0.01 });
    expect(result).toEqual({ inputTokens: 0, outputTokens: 0, cost: 0.01 });
  });

  it('never emits NaN, Infinity, or negative values', () => {
    const result = sanitizeUsage({
      inputTokens: Number.NaN,
      outputTokens: Number.POSITIVE_INFINITY,
      totalTokens: -5,
      cost: -0.01,
    });
    // Nothing usable remains (all zeros / no cost) → null, no done event.
    expect(result).toBeNull();
  });

  it('keeps the usable portion when only some fields are invalid', () => {
    const result = sanitizeUsage({
      inputTokens: 12,
      outputTokens: Number.POSITIVE_INFINITY,
      cost: Number.NaN,
    });
    expect(result).toEqual({ inputTokens: 12, outputTokens: 0 });
  });

  it('returns null for nullish or non-object raw usage', () => {
    expect(sanitizeUsage(null)).toBeNull();
    expect(sanitizeUsage(undefined)).toBeNull();
    expect(sanitizeUsage('nope' as any)).toBeNull();
  });

  it('treats an all-zero usage object as nothing usable', () => {
    expect(sanitizeUsage({ inputTokens: 0, outputTokens: 0, cost: 0 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getUsageBestEffort — bounded, never-throwing race
// ---------------------------------------------------------------------------

describe('getUsageBestEffort', () => {
  it('resolves with sanitized usage when getUsage resolves', async () => {
    const usage = await getUsageBestEffort(
      { getUsage: async () => ({ inputTokens: 10, outputTokens: 5, cost: 0.01 }) },
      100,
    );
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 5, cost: 0.01 });
  });

  it('resolves to null when getUsage rejects', async () => {
    const usage = await getUsageBestEffort(
      { getUsage: async () => { throw new Error('boom'); } },
      100,
    );
    expect(usage).toBeNull();
  });

  it('resolves to null within the timeout bound when getUsage hangs', async () => {
    const startedAt = Date.now();
    const usage = await getUsageBestEffort(
      { getUsage: () => new Promise<never>(() => {}) },
      40,
    );
    const elapsed = Date.now() - startedAt;
    expect(usage).toBeNull();
    expect(elapsed).toBeLessThan(1000);
  });

  it('resolves to null when the result exposes no getUsage', async () => {
    expect(await getUsageBestEffort(null, 10)).toBeNull();
    expect(await getUsageBestEffort({}, 10)).toBeNull();
  });

  it('exposes a bounded default timeout well under the 1.5s SIGKILL escalation', () => {
    expect(ABORT_USAGE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(ABORT_USAGE_TIMEOUT_MS).toBeLessThanOrEqual(1000);
  });
});

// ---------------------------------------------------------------------------
// runAgent abort path — terminal done event with partial usage
// ---------------------------------------------------------------------------

const testConfig: AgentConfig = {
  apiKey: 'test-key',
  model: 'test-model',
  name: 'test',
  systemPrompt: 'You are a test agent working in {cwd}.',
  maxSteps: 5,
  maxCost: 1,
  sessionDir: '.sessions-test',
  sessionEnabled: false,
  outputMode: 'json',
};

interface FakeResultOptions {
  usage?: unknown;
  getUsage?: () => Promise<unknown>;
}

function makeFakeResult(opts: FakeResultOptions) {
  let releaseText!: () => void;
  const textEnded = new Promise<void>((resolve) => { releaseText = resolve; });
  const fake: any = {
    options: undefined,
    cancel() {
      releaseText();
    },
    getTextStream: async function* () {
      yield 'partial ';
      // Simulates the SDK stream ending once cancel() is invoked.
      await textEnded;
    },
    getItemsStream: async function* () {
      await textEnded;
    },
    getResponse: async () => {
      throw new Error('getResponse must not be reached on the abort path');
    },
    getUsage: opts.getUsage ?? (async () => opts.usage ?? null),
  };
  return fake;
}

function installFakeResult(fake: any) {
  currentFakeResult = fake;
}

describe('runAgent abort path', () => {
  it('emits exactly one terminal done event with partial usage when cancelled mid-stream', async () => {
    installFakeResult(makeFakeResult({
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.01 },
    }));

    const events: AgentEvent[] = [];
    const controller = new AbortController();
    const runPromise = runAgent(testConfig, 'test prompt', {
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    });

    // Let the first text delta flow, then cancel mid-run.
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();

    await expect(runPromise).rejects.toMatchObject({ name: 'AbortError', message: 'Aborted' });

    const doneEvents = events.filter((e) => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
    // The done event is terminal — the last event on the channel.
    expect(events[events.length - 1]!.type).toBe('done');
    expect((doneEvents[0] as Extract<AgentEvent, { type: 'done' }>).usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cost: 0.01,
    });
  });

  it('exits without a done event when getUsage throws (best-effort)', async () => {
    installFakeResult(makeFakeResult({
      getUsage: async () => { throw new Error('usage unavailable'); },
    }));

    const events: AgentEvent[] = [];
    const controller = new AbortController();
    const runPromise = runAgent(testConfig, 'test prompt', {
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    });

    await new Promise((r) => setTimeout(r, 20));
    controller.abort();

    await expect(runPromise).rejects.toMatchObject({ message: 'Aborted' });
    expect(events.filter((e) => e.type === 'done')).toHaveLength(0);
  });

  it('exits without a done event when getUsage exceeds the bounded timeout', async () => {
    installFakeResult(makeFakeResult({
      getUsage: () => new Promise<never>(() => {}),
    }));

    const events: AgentEvent[] = [];
    const controller = new AbortController();
    const startedAt = Date.now();
    const runPromise = runAgent(testConfig, 'test prompt', {
      signal: controller.signal,
      abortUsageTimeoutMs: 40,
      onEvent: (event) => events.push(event),
    });

    await new Promise((r) => setTimeout(r, 20));
    controller.abort();

    await expect(runPromise).rejects.toMatchObject({ message: 'Aborted' });
    // Shutdown never exceeds the timeout bound.
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(events.filter((e) => e.type === 'done')).toHaveLength(0);
  });

  it('emits no usage values that are NaN, Infinity, or negative', async () => {
    installFakeResult(makeFakeResult({
      usage: { inputTokens: 12, outputTokens: Number.POSITIVE_INFINITY, cost: Number.NaN },
    }));

    const events: AgentEvent[] = [];
    const controller = new AbortController();
    const runPromise = runAgent(testConfig, 'test prompt', {
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    });

    await new Promise((r) => setTimeout(r, 20));
    controller.abort();

    await expect(runPromise).rejects.toMatchObject({ message: 'Aborted' });
    const doneEvents = events.filter((e) => e.type === 'done') as Extract<AgentEvent, { type: 'done' }>[];
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0]!.usage).toEqual({ inputTokens: 12, outputTokens: 0 });
    const serialized = JSON.stringify(doneEvents[0]!.usage);
    expect(serialized).not.toContain('NaN');
    expect(serialized).not.toContain('Infinity');
    expect(serialized).not.toContain('-');
  });

  it('emits no done event when the aborted run reports nothing usable', async () => {
    installFakeResult(makeFakeResult({
      usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
    }));

    const events: AgentEvent[] = [];
    const controller = new AbortController();
    const runPromise = runAgent(testConfig, 'test prompt', {
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    });

    await new Promise((r) => setTimeout(r, 20));
    controller.abort();

    await expect(runPromise).rejects.toMatchObject({ message: 'Aborted' });
    expect(events.filter((e) => e.type === 'done')).toHaveLength(0);
  });
});
