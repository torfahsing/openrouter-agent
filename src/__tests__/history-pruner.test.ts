import { describe, it, expect } from 'bun:test';
import { pruneHistoricalToolOutputs } from '../history-pruner.js';

describe('pruneHistoricalToolOutputs', () => {
  it('returns small or short item arrays untouched', () => {
    const input = [
      { role: 'user', content: 'hello' },
      { type: 'function_call_output', callId: '1', output: JSON.stringify({ ok: true }) },
    ];
    const result = pruneHistoricalToolOutputs(input);
    expect(result).toEqual(input);
  });

  it('guarantees that all pruned outputs remain valid JSON for JSON.parse', () => {
    const input = [
      { role: 'user', content: 'start' },
      {
        type: 'function_call_output',
        callId: 'c1',
        output: JSON.stringify({ output: 'Error: '.repeat(1000), exitCode: 1 }),
      },
      {
        type: 'function_call_output',
        callId: 'c2',
        output: 'Raw non-json string that is very long '.repeat(200),
      },
    ];
    const result = pruneHistoricalToolOutputs(input, {
      keepRecentItems: 1,
      maxHistoricalToolOutputChars: 300,
    });

    // c1 is historical and was valid JSON object
    expect(() => JSON.parse(result[1].output)).not.toThrow();
    const parsedC1 = JSON.parse(result[1].output);
    expect(parsedC1.exitCode).toBe(1);
    expect(parsedC1.output).toContain('truncated');

    // c2 is historical and was raw string - should be JSON stringified
    expect(() => JSON.parse(result[2].output)).not.toThrow();
  });

  it('preserves index 0 (initial prompt/instructions) completely intact', () => {
    const longPrompt = 'A'.repeat(5000);
    const input = [
      { role: 'user', content: longPrompt },
      { type: 'function_call_output', callId: 'c1', output: JSON.stringify({ out: 'B'.repeat(2000) }) },
      { type: 'function_call_output', callId: 'c2', output: JSON.stringify({ out: 'C'.repeat(2000) }) },
    ];
    const result = pruneHistoricalToolOutputs(input, { keepRecentItems: 1 });
    expect(result[0].content).toBe(longPrompt);
  });

  it('preserves recent items up to keepRecentItems', () => {
    const recentOutput = JSON.stringify({ recent: 'X'.repeat(5000) });
    const input = [
      { role: 'user', content: 'start' },
      { type: 'function_call_output', callId: 'c1', output: JSON.stringify({ hist: 'H'.repeat(5000) }) },
      { type: 'function_call_output', callId: 'c2', output: recentOutput },
    ];
    const result = pruneHistoricalToolOutputs(input, { keepRecentItems: 1, maxHistoricalToolOutputChars: 500 });
    expect(result[2].output).toBe(recentOutput);
    expect(result[1].output.length).toBeLessThan(600);
    expect(result[1].output).toContain('historical output truncated');
    expect(result[1].callId).toBe('c1');
    expect(() => JSON.parse(result[1].output)).not.toThrow();
  });

  it('bounds recent tool outputs that exceed maxRecentToolOutputChars', () => {
    const hugeRecent = JSON.stringify({ output: 'Z'.repeat(60_000) });
    const input = [
      { role: 'user', content: 'start' },
      { type: 'function_call_output', callId: 'c1', output: hugeRecent },
    ];
    const result = pruneHistoricalToolOutputs(input, {
      keepRecentItems: 5,
      maxRecentToolOutputChars: 10_000,
    });
    expect(result[1].output.length).toBeLessThan(11_000);
    expect(result[1].output).toContain('output truncated');
    expect(result[1].callId).toBe('c1');
    expect(() => JSON.parse(result[1].output)).not.toThrow();
  });

  it('handles chat format tool outputs ({ role: "tool", content: string })', () => {
    const input = [
      { role: 'user', content: 'start' },
      { role: 'tool', tool_call_id: 'call_1', content: JSON.stringify({ log: 'E'.repeat(3000) }) },
      { role: 'assistant', content: 'step 1' },
      { role: 'tool', tool_call_id: 'call_2', content: JSON.stringify({ log: 'F'.repeat(100) }) },
    ];
    const result = pruneHistoricalToolOutputs(input, { keepRecentItems: 2, maxHistoricalToolOutputChars: 400 });
    expect(result[1].content.length).toBeLessThan(500);
    expect(result[1].content).toContain('historical output truncated');
    expect(() => JSON.parse(result[1].content)).not.toThrow();
  });
});
