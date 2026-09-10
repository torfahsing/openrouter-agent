import { appendFileSync, mkdirSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Message = { role: string; content: string; [key: string]: unknown };

interface SessionEntry {
  timestamp: string;
  message: Message;
}

export function initSessionDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function saveMessage(sessionPath: string, message: Message): void {
  const entry: SessionEntry = {
    timestamp: new Date().toISOString(),
    message,
  };
  appendFileSync(sessionPath, JSON.stringify(entry) + '\n');
}

export async function loadSession(sessionPath: string): Promise<Message[]> {
  if (!existsSync(sessionPath)) return [];
  try {
    const text = readFileSync(sessionPath, 'utf-8');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          const entry: SessionEntry = JSON.parse(line);
          return entry.message;
        } catch {
          return null;
        }
      })
      .filter((m): m is Message => m !== null);
  } catch {
    return [];
  }
}

export function listSessions(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
}

export function newSessionPath(dir: string): string {
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  return join(dir, `${id}.jsonl`);
}
