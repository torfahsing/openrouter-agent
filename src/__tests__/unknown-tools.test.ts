import { describe, it, expect } from 'bun:test';
import { ModelResult } from '@openrouter/agent';
import { loadConfig } from '../config.js';

describe('unknown and hallucinated tool handling', () => {
  it('defaults maxSteps to 100', () => {
    const config = loadConfig({ model: 'mock' }, { skipApiKey: true });
    expect(config.maxSteps).toBe(100);
  });

  it('synthesizes error tool result for unknown tool calls instead of returning null', async () => {
    // Import agent to ensure monkeypatch is active
    await import('../agent.js');

    const fakeInstance = {
      options: {
        tools: [
          { function: { name: 'file_read' } },
          { function: { name: 'shell' } },
        ],
      },
    };

    const fn = (ModelResult.prototype as any).executeSingleToolCall;
    expect(typeof fn).toBe('function');

    // Call with unknown tool "npx"
    const result = await fn.call(fakeInstance, { id: 'call_123', name: 'npx', arguments: '{}' }, {});
    expect(result).not.toBeNull();
    expect(result.type).toBe('parse_error');
    expect(result.output.type).toBe('function_call_output');
    expect(result.output.callId).toBe('call_123');

    const parsedOutput = JSON.parse(result.output.output);
    expect(parsedOutput.error).toContain('Tool "npx" does not exist');
    expect(parsedOutput.error).toContain('file_read');
    expect(parsedOutput.error).toContain('shell');
  });

  it('passes through known client tools to original handler', async () => {
    await import('../agent.js');

    const fakeInstance = {
      options: {
        tools: [
          { function: { name: 'file_read' } },
        ],
      },
      taskToolActive: () => false,
    };

    const fn = (ModelResult.prototype as any).executeSingleToolCall;
    // Known tool that is not auto-resolvable (mock object without execute) returns null from original,
    // but since it IS in options.tools, it should return null or proceed to auto-resolvable check.
    // However, our patch only intercepts when it returns null AND tool is not in tools.
    // Let's verify with an actual tool that exists in tools:
    const result = await fn.call(fakeInstance, { id: 'call_456', name: 'file_read', arguments: '{}' }, {});
    // Should NOT be intercepted as "does not exist"
    if (result && result.output) {
      const parsed = JSON.parse(result.output.output);
      expect(parsed.error).not.toContain('Tool "file_read" does not exist');
    }
  });
});
