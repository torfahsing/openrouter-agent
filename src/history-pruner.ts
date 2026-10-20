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

/**
 * Bounds multi-turn conversation history by pruning large outputs from older
 * tool rounds while preserving recent context, task instructions, and wire
 * invariants (such as tool_call / function_call_output pairing and call IDs).
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
      if (item.output.length > maxChars) {
        const headChars = Math.max(20, Math.floor(maxChars * 0.45));
        const tailChars = Math.max(20, Math.floor(maxChars * 0.45));
        const marker = isHistorical
          ? `\n\n... [historical output truncated (${item.output.length} chars) to preserve context] ...\n\n`
          : `\n\n... [output truncated (${item.output.length} chars) to stay within limits] ...\n\n`;

        return {
          ...item,
          output: `${item.output.slice(0, headChars)}${marker}${item.output.slice(-tailChars)}`,
        };
      }
    } else if (isChatToolOutput) {
      if (item.content.length > maxChars) {
        const headChars = Math.max(20, Math.floor(maxChars * 0.45));
        const tailChars = Math.max(20, Math.floor(maxChars * 0.45));
        const marker = isHistorical
          ? `\n\n... [historical output truncated (${item.content.length} chars) to preserve context] ...\n\n`
          : `\n\n... [output truncated (${item.content.length} chars) to stay within limits] ...\n\n`;

        return {
          ...item,
          content: `${item.content.slice(0, headChars)}${marker}${item.content.slice(-tailChars)}`,
        };
      }
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
          if (item.output.length > 400) {
            return {
              ...item,
              output: `${item.output.slice(0, 150)}\n\n... [emergency payload pruning] ...\n\n${item.output.slice(-150)}`,
            };
          }
        }
        if (item?.role === 'tool' && typeof item.content === 'string') {
          if (item.content.length > 400) {
            return {
              ...item,
              content: `${item.content.slice(0, 150)}\n\n... [emergency payload pruning] ...\n\n${item.content.slice(-150)}`,
            };
          }
        }
        return item;
      });
    }
  } catch {
    // If JSON stringify fails, return pruned as-is
  }

  return pruned;
}
