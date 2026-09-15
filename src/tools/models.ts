import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';

export const OPENROUTER_CATEGORIES = [
  'programming',
  'roleplay',
  'marketing',
  'marketing/seo',
  'technology',
  'science',
  'translation',
  'legal',
  'finance',
  'health',
  'trivia',
  'academia',
] as const;

export const openrouterModelsTool = tool({
  name: 'openrouter_models',
  description:
    'Query the official OpenRouter live catalog for available models, exact pricing, and context windows filtered by use-case category without using web search.',
  inputSchema: z.object({
    category: z
      .enum(OPENROUTER_CATEGORIES)
      .optional()
      .describe(
        'Optional leaderboard category filter (warning: OpenRouter caps category queries to top 20 models). Omit to search the full catalog.',
      ),
    onlyFree: z
      .boolean()
      .optional()
      .describe('Filter only for models with $0 prompt and completion pricing.'),
    search: z
      .string()
      .optional()
      .describe('Filter model ID or name by keyword (e.g. "deepseek", "claude", "qwen", "free").'),
    minContext: z
      .number()
      .optional()
      .describe('Filter by minimum context window size (e.g. 64000).'),
    toolsOnly: z
      .boolean()
      .optional()
      .default(true)
      .describe('Filter for models supporting tool calling (supported_parameters=tools). Default is true.'),
    sort: z
      .enum([
        'pricing-low-to-high',
        'pricing-high-to-low',
        'context-high-to-low',
        'throughput-high-to-low',
        'latency-low-to-high',
        'most-popular',
        'newest',
      ])
      .optional()
      .default('pricing-low-to-high')
      .describe('Server-side sort order. Default is "pricing-low-to-high".'),
  }),
  execute: async ({ category, onlyFree, search, minContext, toolsOnly = true, sort = 'pricing-low-to-high' }) => {
    try {
      const url = new URL('https://openrouter.ai/api/v1/models');
      if (category) {
        url.searchParams.set('category', category);
      }
      if (toolsOnly) {
        url.searchParams.set('supported_parameters', 'tools');
      }
      if (sort) {
        url.searchParams.set('sort', sort);
      }

      const headers: Record<string, string> = {};
      if (process.env.OPENROUTER_API_KEY) {
        headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
      }

      const res = await fetch(url.toString(), {
        headers,
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        return { error: `OpenRouter API returned status ${res.status}: ${res.statusText}` };
      }

      const json = (await res.json()) as { data?: any[] };
      let models = Array.isArray(json?.data) ? json.data : [];

      if (onlyFree) {
        models = models.filter((m) => {
          const p = parseFloat(m.pricing?.prompt || '0');
          const c = parseFloat(m.pricing?.completion || '0');
          return p === 0 && c === 0;
        });
      }

      if (search) {
        const query = search.toLowerCase();
        models = models.filter(
          (m) =>
            (m.id && m.id.toLowerCase().includes(query)) ||
            (m.name && m.name.toLowerCase().includes(query)),
        );
      }

      if (minContext && minContext > 0) {
        models = models.filter((m) => (m.context_length || 0) >= minContext);
      }

      const simplified = models.slice(0, 30).map((m) => {
        const promptPer1M = (parseFloat(m.pricing?.prompt || '0') * 1_000_000).toFixed(4);
        const completionPer1M = (parseFloat(m.pricing?.completion || '0') * 1_000_000).toFixed(4);
        return {
          id: m.id,
          name: m.name || m.id,
          context_length: m.context_length || 0,
          pricing: `$${promptPer1M} in / $${completionPer1M} out per 1M tokens`,
          is_free: promptPer1M === '0.0000' && completionPer1M === '0.0000',
        };
      });

      return {
        category,
        total_found: models.length,
        returned: simplified.length,
        models: simplified,
      };
    } catch (err: any) {
      return { error: `Failed to fetch OpenRouter models: ${err.message}` };
    }
  },
});
