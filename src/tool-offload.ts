import { resolve, sep } from 'node:path';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';

export interface OffloadConfig {
  /** Results larger than this are persisted. Default 50,000 bytes. */
  maxInlineBytes: number;
  /** How many bytes of the head to keep inline as a preview. */
  previewBytes: number;
  /** Where to write persisted results. One file per call id. */
  storageDir: string;
}

export const OFFLOAD_DEFAULTS: OffloadConfig = {
  maxInlineBytes: 50_000,
  previewBytes: 2_000,
  storageDir: '.agent-state/tool-results',
};

/**
 * If a tool's serialized result exceeds `maxInlineBytes`, persist it to disk
 * and return a preview + pointer instead. Otherwise pass it through.
 */
export async function offloadIfLarge<T>(
  result: T,
  ctx: { callId?: string } | undefined,
  opts: Partial<OffloadConfig> = {},
): Promise<T | {
  preview: string;
  truncated: true;
  totalBytes: number;
  persistedAt: string;
  hint: string;
}> {
  const config = { ...OFFLOAD_DEFAULTS, ...opts };
  const serialized = typeof result === 'string' ? result : JSON.stringify(result);

  if (serialized.length <= config.maxInlineBytes) return result;

  if (!existsSync(config.storageDir)) {
    mkdirSync(config.storageDir, { recursive: true });
  }

  const callId = ctx?.callId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = resolve(config.storageDir, `${callId}.txt`);
  writeFileSync(path, serialized);

  return {
    preview: serialized.slice(0, config.previewBytes),
    truncated: true,
    totalBytes: serialized.length,
    persistedAt: path,
    hint: `Full output (${serialized.length} bytes) saved to ${path}. Use read_persisted_result({ path, offset, limit }) to read specific sections.`,
  };
}

/**
 * Validate that a path resolves to somewhere inside `storageDir`.
 */
export function isInsideStorageDir(path: string, storageDir: string): boolean {
  const resolvedDir = resolve(storageDir) + sep;
  const resolvedPath = resolve(path);
  return resolvedPath === resolve(storageDir) || resolvedPath.startsWith(resolvedDir);
}
