import { describe, it, expect } from 'bun:test';
import { pruneHistoricalToolOutputs } from '../history-pruner.js';

describe('pruneHistoricalToolOutputs', () => {
  it('returns small or short item arrays untouched', () => {
    const input = [
      { role: 'user', content: 'hello' },
      { type: 'function_call_output', callId: '1', output: 'ok' },
    ];
    const result = pruneHistoricalToolOutputs(input);
    expect(result).toEqual(input);
  });

  it('preserves index 0 (initial prompt/instructions) completely intact', () => {
    const longPrompt = 'A'.repeat(5000);
    const input = [
      { role: 'user', content: longPrompt },
      { type: 'function_call_output', callId: 'c1', output: 'B'.repeat(2000) },
      { type: 'function_call_output', callId: 'c2', output: 'C'.repeat(2000) },
      { type: 'function_call_output', callId: 'c3', output: 'D'.repeat(2000) },
    ];
    const result = pruneHistoricalToolOutputs(input, { keepRecentItems: 1 });
    expect(result[0].content).toBe(longPrompt);
  });

  it('preserves recent items up to keepRecentItems', () => {
    const recentOutput = 'X'.repeat(5000);
    const input = [
      { role: 'user', content: 'start' },
      { type: 'function_call_output', callId: 'c1', output: 'H'.repeat(5000) },
      { type: 'function_call_output', callId: 'c2', output: recentOutput },
    ];
    // keepRecentItems: 1 means index 2 (c2) is recent, c1 is historical
    const result = pruneHistoricalToolOutputs(input, { keepRecentItems: 1, maxHistoricalToolOutputChars: 500 });
    expect(result[2].output).toBe(recentOutput);
    expect(result[1].output.length).toBeLessThan(600);
    expect(result[1].output).toContain('historical output truncated');
    expect(result[1].callId).toBe('c1');
  });

  it('bounds recent tool outputs that exceed maxRecentToolOutputChars', () => {
    const hugeRecent = 'Z'.repeat(60_000);
    const input = [
      { role: 'user', content: 'start' },
      { type: 'function_call_output', callId: 'c1', output: hugeRecent },
    ];
    const result = pruneHistoricalToolOutputs(input, {
      keepRecentItems: 5,
      maxRecentToolOutputChars: 10_000,
    });
    expect(result[1].output.length).toBeLessThan(11_000);
    expect(result[1].output).toContain('output truncated (60000 chars)');
    expect(result[1].callId).toBe('c1');
  });

  it('handles chat format tool outputs ({ role: "tool", content: string })', () => {
    const input = [
      { role: 'user', content: 'start' },
      { role: 'tool', tool_call_id: 'call_1', content: 'E'.repeat(3000) },
      { role: 'assistant', content: 'step 1' },
      { role: 'tool', tool_call_id: 'call_2', content: 'F'.repeat(100) },
    ];
    const result = pruneHistoricalToolOutputs(input, { keepRecentItems: 2, maxHistoricalToolOutputChars: 400 });
    expect(result[1].content.length).toBeLessThan(500);
    expect(result[1].content).toContain('historical output truncated');
    expect(result[3].content).toBe('F'.repeat(100));
  });

  it('triggers emergency payload pruning when cumulative size exceeds maxTotalPayloadBytes', () => {
    const input = [
      { role: 'user', content: 'instructions' },
      { type: 'function_call_output', callId: 'c1', output: '1'.repeat(1000) },
      { type: 'function_call_output', callId: 'c2', output: '2'.repeat(1000) },
      { type: 'function_call_output', callId: 'c3', output: '3'.repeat(1000) },
    ];
    const result = pruneHistoricalToolOutputs(input, {
      keepRecentItems: 10,
      maxTotalPayloadBytes: 2000, // force emergency pruning
    });
    for (let i = 1; i <= 3; i++) {
      expect(result[i].output).toContain('emergency payload pruning');
      expect(result[i].output.length).toBeLessThan(500);
    }
  });
});
