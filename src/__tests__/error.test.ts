import { describe, it, expect } from 'bun:test';
import { extractOpenRouterErrorMessage } from '../error.js';

describe('extractOpenRouterErrorMessage', () => {
  it('extracts upstream rate limit error with metadata and remedy hint', () => {
    const err = {
      name: 'TooManyRequestsResponseError',
      statusCode: 429,
      error: {
        code: 429,
        message: 'Provider returned error',
        metadata: {
          raw: 'qwen/qwen3.8-flash is temporarily rate-limited upstream. Please retry shortly.',
          provider_name: 'Alibaba',
          is_byok: false,
          limit_source: 'upstream_provider_shared_pool',
          remedy_hint: 'Retry shortly, or route to another provider.',
        },
      },
    };

    const formatted = extractOpenRouterErrorMessage(err);
    expect(formatted).toContain('[OpenRouter / Alibaba 429]');
    expect(formatted).toContain('qwen/qwen3.8-flash is temporarily rate-limited upstream.');
    expect(formatted).toContain('Remedy: Retry shortly, or route to another provider.');
  });

  it('unpacks nested error inside data$', () => {
    const err = {
      statusCode: 502,
      data$: {
        error: {
          code: 502,
          message: 'Provider returned error',
          metadata: {
            raw: 'Service unavailable on upstream provider',
            provider_name: 'DeepSeek',
          },
        },
      },
    };

    const formatted = extractOpenRouterErrorMessage(err);
    expect(formatted).toBe('[OpenRouter / DeepSeek 502] Service unavailable on upstream provider');
  });

  it('unpacks error JSON string in body$', () => {
    const err = {
      body: JSON.stringify({
        error: {
          code: 429,
          message: 'Provider returned error',
          metadata: {
            provider_name: 'Alibaba',
            raw: 'Rate limit exceeded',
          },
        },
      }),
    };

    const formatted = extractOpenRouterErrorMessage(err);
    expect(formatted).toBe('[OpenRouter / Alibaba 429] Rate limit exceeded');
  });

  it('formats error with code but no metadata gracefully', () => {
    const err = {
      status: 503,
      message: 'Service Unavailable',
    };

    const formatted = extractOpenRouterErrorMessage(err);
    expect(formatted).toBe('[OpenRouter 503] Service Unavailable');
  });

  it('enriches generic Provider returned error with actionable guidance', () => {
    const err429 = {
      statusCode: 429,
      message: 'Provider returned error',
    };
    expect(extractOpenRouterErrorMessage(err429)).toContain('Upstream provider rate-limited or capacity exceeded');

    const err502 = {
      statusCode: 502,
      message: 'Provider returned error',
    };
    expect(extractOpenRouterErrorMessage(err502)).toContain('Upstream provider is temporarily unavailable or overloaded');
  });

  it('returns plain message when no OpenRouter metadata or code is present', () => {
    const err = new Error('fetch failed');
    const formatted = extractOpenRouterErrorMessage(err);
    expect(formatted).toBe('fetch failed');
  });

  it('handles empty or null inputs', () => {
    expect(extractOpenRouterErrorMessage(null)).toBe('Unknown error');
    expect(extractOpenRouterErrorMessage(undefined)).toBe('Unknown error');
  });
});
