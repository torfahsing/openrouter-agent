export interface PruneHistoryOptions {
  /** Number of recent conversation items to keep completely untouched (default: 10) */
  keepRecentItems?: number;
  /** Max characters allowed for historical tool results (default: 500) */
  maxHistoricalToolOutputChars?: number;
  /** Max characters allowed for recent tool results (default: 40_000) */
  maxRecentToolOutputChars?: number;
  /** Max total serialized payload before emergency pruning (default: 2_000_000 bytes) */
  maxTotalPayloadBytes?: number;
}

export const PRUNE_DEFAULTS: Required<PruneHistoryOptions> = {
  keepRecentItems: 10,
  maxHistoricalToolOutputChars: 500,
  maxRecentToolOutputChars: 40_000,
  maxTotalPayloadBytes: 2_000_000, // 2 MB target (well below OpenRouter's 8 MB limit)
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
  } = { ...PRUNE_DEFAULTS, ...opts };

  const cutIndex = Math.max(1, items.length - keepRecentItems);

  // Shallow-clone items, pruning oversized tool outputs
  const pruned = items.map((item, index) => {
    if (!item) return item;

    const isSdkToolOutput = item.type === 'function_call_output' && typeof item.output === 'string';
    const isChatToolOutput = item.role === 'tool' && typeof item.content === 'string';

    if (!isSdkToolOutput && !isChatToolOutput) {
      return item;
    }

    const isHistorical = index < cutIndex;
    const maxChars = isHistorical ? maxHistoricalToolOutputChars : maxRecentToolOutputChars;

    if (isSdkToolOutput) {
      return {
        ...item,
        output: pruneToolOutput(item.output, maxChars, isHistorical),
      };
    } else if (isChatToolOutput) {
      return {
        ...item,
        content: pruneToolOutput(item.content, maxChars, isHistorical),
      };
    }

    return item;
  });

  // Emergency safety check: if total JSON size is still > maxTotalPayloadBytes,
  // aggressively prune all non-initial tool outputs.
  try {
    const totalSize = JSON.stringify(pruned).length;
    if (totalSize > maxTotalPayloadBytes) {
      return pruned.map((item, index) => {
        // Never truncate initial user instructions (index 0)
        if (index === 0) return item;

        if (item?.type === 'function_call_output' && typeof item.output === 'string') {
          return {
            ...item,
            output: pruneToolOutput(item.output, 300, true),
          };
        }
        if (item?.role === 'tool' && typeof item.content === 'string') {
          return {
            ...item,
            content: pruneToolOutput(item.content, 300, true),
          };
        }
        return item;
      });
    }
  } catch {
    // If JSON stringify fails, return pruned as-is
  }

  return pruned;
}
