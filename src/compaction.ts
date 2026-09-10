import { OpenRouter } from '@openrouter/agent';

type Message = { role: string; content: string; [key: string]: unknown };

interface CompactionConfig {
  /** Max messages before triggering compaction */
  threshold: number;
  /** Number of recent messages to preserve verbatim */
  keepRecent: number;
  /** Model to use for summarization (should be cheap/fast) */
  model: string;
}

const DEFAULTS: CompactionConfig = {
  threshold: 40,
  keepRecent: 10,
  model: 'google/gemini-2.5-flash', // A cheap, fast model for summarization
};

function findSafeBoundary(messages: Message[], cut: number): number {
  while (cut < messages.length) {
    const msg = messages[cut];

    // Orphaned tool result at the boundary — step past it so the pair
    // stays together on the summarized side.
    if (msg.role === 'tool') {
      cut++;
      continue;
    }

    // Assistant with unresolved tool_calls — step past it and any
    // trailing tool results from the same turn.
    const toolCalls = (msg as { tool_calls?: unknown[] }).tool_calls;
    if (msg.role === 'assistant' && Array.isArray(toolCalls) && toolCalls.length > 0) {
      cut++;
      while (cut < messages.length && messages[cut].role === 'tool') {
        cut++;
      }
      continue;
    }

    break;
  }
  return cut;
}

export async function compactMessages(
  client: OpenRouter,
  messages: Message[],
  config: Partial<CompactionConfig> = {},
): Promise<Message[]> {
  const opts = { ...DEFAULTS, ...config };

  if (messages.length <= opts.threshold) return messages;

  const idealCut = messages.length - opts.keepRecent;
  const safeCut = findSafeBoundary(messages, idealCut);

  // If the boundary walked all the way to the end, give up on compacting
  // rather than leaving no message behind.
  if (safeCut >= messages.length) return messages;

  const toSummarize = messages.slice(0, safeCut);
  const toKeep = messages.slice(safeCut);

  const summaryResult = client.callModel({
    model: opts.model,
    instructions:
      'Summarize the following conversation history concisely. Preserve key details, instructions, decisions, and any file paths mentioned. Output ONLY the summary.',
    input: toSummarize.map((m) => `${m.role}: ${m.content}`).join('\n\n'),
  });

  const summary = await summaryResult.getText();

  return [
    { role: 'system', content: `[Previous conversation summary]\n${summary}` },
    ...toKeep,
  ];
}
