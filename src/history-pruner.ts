export interface PruneHistoryOptions {
  /** Number of recent conversation items to keep completely untouched when emergency pruning (default: 10) */
  keepRecentItems?: number;
  /** Max characters allowed for historical tool results when emergency pruning (default: 2_000) */
  maxHistoricalToolOutputChars?: number;
  /** Max characters allowed for any single tool result (default: 50_000) */
  maxRecentToolOutputChars?: number;
  /** Max total serialized payload before emergency pruning (default: 4_000_000 bytes) */
  maxTotalPayloadBytes?: number;
  /** Whether to force historical pruning regardless of total payload size (default: false) */
  forcePruneHistorical?: boolean;
}

export const PRUNE_DEFAULTS: Required<PruneHistoryOptions> = {
  keepRecentItems: 10,
  maxHistoricalToolOutputChars: 2_000,
  maxRecentToolOutputChars: 50_000,
  maxTotalPayloadBytes: 4_000_000, // 4 MB target (well below OpenRouter's 8 MB limit)
  forcePruneHistorical: false,
};

function truncateString(str: string, maxChars: number, marker: string): string {
  if (str.length <= maxChars) return str;
  const avail = Math.max(20, maxChars - marker.length);
  const headChars = Math.floor(avail * 0.5);
  const tailChars = Math.floor(avail * 0.5);
  return `${str.slice(0, headChars)}${marker}${str.slice(-tailChars)}`;
}

/**
 * Prunes a tool output string while guaranteeing the returned value remains
 * valid JSON (required because @openrouter/agent executes JSON.parse(tr.output)).
 */
export function pruneToolOutput(rawOutput: string, maxChars: number, isHistorical: boolean): string {
  if (rawOutput.length <= maxChars) {
    // Already small enough. Ensure it parses cleanly if needed; if already valid JSON, keep as-is.
    try {
      JSON.parse(rawOutput);
      return rawOutput;
    } catch {
      return JSON.stringify(rawOutput);
    }
  }

  const marker = isHistorical
    ? `\n\n... [historical output truncated (${rawOutput.length} chars) to preserve context] ...\n\n`
    : `\n\n... [output truncated (${rawOutput.length} chars) to stay within limits] ...\n\n`;

  try {
    const parsed = JSON.parse(rawOutput);
    if (parsed && typeof parsed === 'object') {
      let anyTruncated = false;
      const budgetPerField = Math.max(40, Math.floor(maxChars * 0.7));
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === 'string' && val.length > budgetPerField) {
          (parsed as any)[key] = truncateString(val, budgetPerField, marker);
          anyTruncated = true;
        }
      }
      if (Array.isArray((parsed as any).results) && (parsed as any).results.length > 3) {
        (parsed as any).results = (parsed as any).results.slice(0, 3);
        (parsed as any).truncated = true;
        anyTruncated = true;
      }
      if (Array.isArray((parsed as any).entries) && (parsed as any).entries.length > 10) {
        (parsed as any).entries = (parsed as any).entries.slice(0, 10);
        (parsed as any).truncated = true;
        anyTruncated = true;
      }
      if (!anyTruncated) {
        const serialized = JSON.stringify(parsed);
        if (serialized.length > maxChars) {
          return JSON.stringify({
            ...parsed,
            truncated: true,
            summary: truncateString(serialized, budgetPerField, marker),
          });
        }
      }
      return JSON.stringify(parsed);
    }
    if (typeof parsed === 'string') {
      return JSON.stringify(truncateString(parsed, maxChars, marker));
    }
    return JSON.stringify(parsed);
  } catch {
    // If not JSON, truncate the raw string and stringify it so JSON.parse never fails
    return JSON.stringify(truncateString(rawOutput, maxChars, marker));
  }
}

/**
 * Bounds multi-turn conversation history by pruning large outputs from older
 * tool rounds while preserving recent context, task instructions, and wire
 * invariants (such as tool_call / function_call_output pairing and JSON validity).
 */
export function pruneHistoricalToolOutputs(
  items: any[],
  opts: PruneHistoryOptions = {},
): any[] {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }

  const {
    keepRecentItems,
    maxHistoricalToolOutputChars,
    maxRecentToolOutputChars,
    maxTotalPayloadBytes,
    forcePruneHistorical,
  } = { ...PRUNE_DEFAULTS, ...opts };

  // 1. Cap individual oversized tool outputs and sanitize non-JSON outputs
  let modified = false;
  let candidate = items.map((item) => {
    if (!item) return item;

    const isSdkToolOutput = item.type === 'function_call_output' && typeof item.output === 'string';
    const isChatToolOutput = item.role === 'tool' && typeof item.content === 'string';

    if (isSdkToolOutput) {
      let isValidJson = true;
      try { JSON.parse(item.output); } catch { isValidJson = false; }
      if (!isValidJson || item.output.length > maxRecentToolOutputChars) {
        modified = true;
        return {
          ...item,
          output: pruneToolOutput(item.output, maxRecentToolOutputChars, false),
        };
      }
    } else if (isChatToolOutput) {
      let isValidJson = true;
      try { JSON.parse(item.content); } catch { isValidJson = false; }
      if (!isValidJson || item.content.length > maxRecentToolOutputChars) {
        modified = true;
        return {
          ...item,
          content: pruneToolOutput(item.content, maxRecentToolOutputChars, false),
        };
      }
    }

    return item;
  });

  // 2. Check total serialized payload size
  let totalSize = 0;
  try {
    totalSize = JSON.stringify(candidate).length;
  } catch {
    return candidate;
  }

  // If under budget and not explicitly forced, leave historical tool outputs untouched
  // to preserve multi-turn memory and prompt caching KV prefix.
  const shouldPruneHistorical = forcePruneHistorical || opts.maxHistoricalToolOutputChars !== undefined;
  if (!shouldPruneHistorical && totalSize <= maxTotalPayloadBytes) {
    return modified ? candidate : items;
  }

  // 3. Emergency or forced pruning: prune historical items older than keepRecentItems
  const cutIndex = Math.max(1, candidate.length - keepRecentItems);
  candidate = candidate.map((item, index) => {
    if (!item || index >= cutIndex) return item;

    const isSdkToolOutput = item.type === 'function_call_output' && typeof item.output === 'string';
    const isChatToolOutput = item.role === 'tool' && typeof item.content === 'string';

    if (isSdkToolOutput && item.output.length > maxHistoricalToolOutputChars) {
      return {
        ...item,
        output: pruneToolOutput(item.output, maxHistoricalToolOutputChars, true),
      };
    } else if (isChatToolOutput && item.content.length > maxHistoricalToolOutputChars) {
      return {
        ...item,
        content: pruneToolOutput(item.content, maxHistoricalToolOutputChars, true),
      };
    }

    return item;
  });

  // 4. Secondary emergency: if STILL over maxTotalPayloadBytes, aggressively truncate all tool outputs
  try {
    totalSize = JSON.stringify(candidate).length;
    if (totalSize > maxTotalPayloadBytes) {
      return candidate.map((item, index) => {
        // Never truncate initial user instructions (index 0)
        if (index === 0) return item;

        if (item?.type === 'function_call_output' && typeof item.output === 'string') {
          return {
            ...item,
            output: pruneToolOutput(item.output, 500, true),
          };
        }
        if (item?.role === 'tool' && typeof item.content === 'string') {
          return {
            ...item,
            content: pruneToolOutput(item.content, 500, true),
          };
        }
        return item;
      });
    }
  } catch {
    // If JSON stringify fails, return candidate as-is
  }

  return candidate;
}
