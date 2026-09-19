import { describe, it, expect } from 'bun:test';
import { OPENROUTER_AGENT_CAPABILITIES } from '../capabilities.js';

describe('openrouter-agent capabilities', () => {
  it('conforms to specflow-agent-v1 protocol', () => {
    expect(OPENROUTER_AGENT_CAPABILITIES.protocol).toBe('specflow-agent-v1');
    expect(OPENROUTER_AGENT_CAPABILITIES.name).toBe('openrouter-agent');
    expect(Array.isArray(OPENROUTER_AGENT_CAPABILITIES.tools)).toBe(true);
    expect(Array.isArray(OPENROUTER_AGENT_CAPABILITIES.categories)).toBe(true);
  });

  it('declares readOnly property on every tool', () => {
    for (const tool of OPENROUTER_AGENT_CAPABILITIES.tools) {
      expect(typeof tool.readOnly).toBe('boolean');
      expect(typeof tool.id).toBe('string');
      expect(typeof tool.category).toBe('string');
    }
  });

  it('marks read and search tools as readOnly, and write/shell as not readOnly', () => {
    const fileRead = OPENROUTER_AGENT_CAPABILITIES.tools.find(t => t.id === 'file_read');
    const grep = OPENROUTER_AGENT_CAPABILITIES.tools.find(t => t.id === 'grep');
    const shell = OPENROUTER_AGENT_CAPABILITIES.tools.find(t => t.id === 'shell');
    const fileWrite = OPENROUTER_AGENT_CAPABILITIES.tools.find(t => t.id === 'file_write');

    expect(fileRead?.readOnly).toBe(true);
    expect(grep?.readOnly).toBe(true);
    expect(shell?.readOnly).toBe(false);
    expect(fileWrite?.readOnly).toBe(false);
  });
});
