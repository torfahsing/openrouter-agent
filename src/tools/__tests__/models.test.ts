import { describe, expect, it } from 'bun:test';
import { openrouterModelsTool, OPENROUTER_CATEGORIES } from '../models';

describe('openrouterModelsTool', () => {
  it('has correct tool name and categories', () => {
    expect((openrouterModelsTool as any).function.name).toBe('openrouter_models');
    expect(OPENROUTER_CATEGORIES).toContain('programming');
    expect(OPENROUTER_CATEGORIES).toContain('science');
    expect(OPENROUTER_CATEGORIES).toContain('technology');
  });

  it('filters models by keyword and free status', async () => {
    // Mock global fetch for deterministic test
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      expect(url).toContain('category=programming');
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'meta-llama/llama-3.3-70b-instruct:free',
              name: 'Llama 3.3 70B Free',
              context_length: 128000,
              pricing: { prompt: '0', completion: '0' },
            },
            {
              id: 'anthropic/claude-3.7-sonnet',
              name: 'Claude 3.7 Sonnet',
              context_length: 200000,
              pricing: { prompt: '0.000003', completion: '0.000015' },
            },
          ],
        }),
      } as Response;
    }) as any;

    try {
      const result: any = await (openrouterModelsTool as any).function.execute(
        { category: 'programming', onlyFree: true },
        {} as any,
      );

      expect(result.error).toBeUndefined();
      expect(result.category).toBe('programming');
      expect(result.returned).toBe(1);
      expect(result.models[0].id).toBe('meta-llama/llama-3.3-70b-instruct:free');
      expect(result.models[0].is_free).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
