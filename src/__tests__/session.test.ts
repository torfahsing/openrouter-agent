import { describe, expect, it, afterEach } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, rmSync } from 'node:fs';
import { initSessionDir, saveMessage, loadSession, listSessions, newSessionPath } from '../session.js';

describe('openrouter-agent session store', () => {
  const testDir = join(tmpdir(), `openrouter-sess-test-${Date.now()}`);

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('initializes session directory', () => {
    expect(existsSync(testDir)).toBe(false);
    initSessionDir(testDir);
    expect(existsSync(testDir)).toBe(true);
  });

  it('saves and loads multi-turn messages preserving order', async () => {
    initSessionDir(testDir);
    const sessionFile = join(testDir, 'test-session.jsonl');

    saveMessage(sessionFile, { role: 'user', content: 'Hello' });
    saveMessage(sessionFile, { role: 'assistant', content: 'Hi there! How can I help?' });
    saveMessage(sessionFile, { role: 'user', content: 'Show me my files' });

    const history = await loadSession(sessionFile);
    expect(history).toHaveLength(3);
    expect(history[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(history[1]).toEqual({ role: 'assistant', content: 'Hi there! How can I help?' });
    expect(history[2]).toEqual({ role: 'user', content: 'Show me my files' });
  });

  it('returns empty array when session file does not exist', async () => {
    const history = await loadSession(join(testDir, 'nonexistent.jsonl'));
    expect(history).toEqual([]);
  });

  it('lists existing sessions', () => {
    initSessionDir(testDir);
    saveMessage(join(testDir, 'session-1.jsonl'), { role: 'user', content: '1' });
    saveMessage(join(testDir, 'session-2.jsonl'), { role: 'user', content: '2' });

    const sessions = listSessions(testDir);
    expect(sessions).toEqual(['session-1.jsonl', 'session-2.jsonl']);
  });
});
