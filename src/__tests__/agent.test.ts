import { describe, expect, it } from 'bun:test';
import { normalizeUsage, type DoneUsage } from '../agent';

describe('normalizeUsage', () => {
  it('forwards input/output tokens and the exact USD cost from SessionUsageTotals', () => {
    const totals = {
      inputTokens: 194,
      outputTokens: 2,
      totalTokens: 196,
      cachedTokens: 50,
      reasoningTokens: 0,
      modelCalls: 1,
      cost: 0.000095,
    };
    const result = normalizeUsage(totals);
    expect(result).toEqual({
      inputTokens: 194,
      outputTokens: 2,
      totalTokens: 196,
      cachedTokens: 50,
      reasoningTokens: 0,
      cost: 0.000095,
    } satisfies DoneUsage);
  });

  it('preserves costDetails when the final response reports them', () => {
    const usage = {
      inputTokens: 194,
      outputTokens: 2,
      totalTokens: 196,
      inputTokensDetails: {} as Record<string, unknown>,
      outputTokensDetails: {} as Record<string, unknown>,
      cost: 0.000095,
      costDetails: {
        upstreamInferenceCost: 0.000019,
        upstreamInferenceInputCost: 0.00008,
        upstreamInferenceOutputCost: 0.000015,
      },
    };
    const result = normalizeUsage(usage);
    expect(result).toEqual({
      inputTokens: 194,
      outputTokens: 2,
      totalTokens: 196,
      cost: 0.000095,
      costDetails: {
        upstreamInferenceCost: 0.000019,
        upstreamInferenceInputCost: 0.00008,
        upstreamInferenceOutputCost: 0.000015,
      },
    } satisfies DoneUsage);
  });

  it('drops cost when the upstream did not report one (cost omitted)', () => {
    const result = normalizeUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(result).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(result).not.toHaveProperty('cost');
  });

  it('drops a null cost (free tier): cost is not emitted', () => {
    const result = normalizeUsage({ inputTokens: 1, outputTokens: 1, cost: null });
    expect(result).toEqual({ inputTokens: 1, outputTokens: 1 });
    expect(result).not.toHaveProperty('cost');
  });

  it('returns null for nullish raw usage', () => {
    expect(normalizeUsage(null)).toBeNull();
    expect(normalizeUsage(undefined)).toBeNull();
  });

  it('drops unknown extra fields such as modelCalls', () => {
    const result = normalizeUsage({ inputTokens: 3, outputTokens: 4, modelCalls: 2 });
    expect(result).toEqual({ inputTokens: 3, outputTokens: 4 });
    expect(result).not.toHaveProperty('modelCalls');
  });

  it('omits optional fields that are not reported', () => {
    const result = normalizeUsage({ inputTokens: 3, totalTokens: 9 });
    expect(result).toEqual({ inputTokens: 3, totalTokens: 9 });
    expect(result).not.toHaveProperty('outputTokens');
    expect(result).not.toHaveProperty('cachedTokens');
    expect(result).not.toHaveProperty('reasoningTokens');
  });
});