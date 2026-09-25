/**
 * Error extraction and formatting utilities for OpenRouter API responses.
 *
 * OpenRouter returns rich metadata inside `error.metadata` (e.g. `raw`, `provider_name`,
 * `remedy_hint`, `limit_source`) that describes the exact upstream provider rejection.
 * Standard SDK error wrappers often only expose the generic top-level `error.message`
 * (such as "Provider returned error"). This utility unpacks that metadata into an
 * actionable, human-readable error message.
 */

export interface OpenRouterErrorMetadata {
  raw?: string;
  provider_name?: string;
  is_byok?: boolean;
  limit_source?: string;
  remedy_hint?: string;
  [key: string]: unknown;
}

export function extractOpenRouterErrorMessage(err: any): string {
  if (!err) return 'Unknown error';

  if (typeof err === 'string') {
    try {
      const parsed = JSON.parse(err);
      if (parsed && typeof parsed === 'object') {
        return extractOpenRouterErrorMessage(parsed);
      }
    } catch {
      return err;
    }
  }

  let errorObj: any = null;
  let metadata: OpenRouterErrorMetadata | null = null;
  let code: number | string | undefined = undefined;
  let message: string | undefined = undefined;

  // Check common error container shapes
  if (err.error && typeof err.error === 'object') {
    errorObj = err.error;
  } else if (err.data$?.error && typeof err.data$.error === 'object') {
    errorObj = err.data$.error;
  } else if (err.response?.error && typeof err.response.error === 'object') {
    errorObj = err.response.error;
  } else if (err.body && typeof err.body === 'string') {
    try {
      const parsed = JSON.parse(err.body);
      if (parsed?.error && typeof parsed.error === 'object') {
        errorObj = parsed.error;
      }
    } catch {
      // ignore
    }
  }

  if (errorObj) {
    metadata = errorObj.metadata ?? err.openrouterMetadata ?? null;
    code = errorObj.code;
    message = errorObj.message;
  }

  if (code === undefined) {
    code = err.statusCode ?? err.status;
  }
  if (!message) {
    message = err.message ?? (typeof err === 'object' && err.name ? err.name : String(err));
  }
  if (!metadata && err.openrouterMetadata) {
    metadata = err.openrouterMetadata;
  }

  const provider = metadata?.provider_name;
  const raw = metadata?.raw;
  const remedy = metadata?.remedy_hint;
  const limitSource = metadata?.limit_source;

  // If no OpenRouter-specific metadata or status code is present, fallback to plain message
  if (!provider && !raw && !code) {
    return message || 'Unknown error';
  }

  const prefix = provider
    ? `[OpenRouter / ${provider}${code ? ` ${code}` : ''}]`
    : (code ? `[OpenRouter ${code}]` : '[OpenRouter]');

  const parts: string[] = [];
  if (raw) {
    parts.push(String(raw).trim());
  } else if (message) {
    let text = String(message).trim();
    if (text === 'Provider returned error') {
      if (code === 429) {
        text = 'Provider returned error: Upstream provider rate-limited or capacity exceeded. Please retry shortly or switch/add a fallback model.';
      } else if (code === 502 || code === 503 || code === 504) {
        text = 'Provider returned error: Upstream provider is temporarily unavailable or overloaded. Please retry shortly or switch/add a fallback model.';
      } else if (code === 402) {
        text = 'Provider returned error: Insufficient credits. Please check your OpenRouter account balance.';
      }
    }
    parts.push(text);
  }

  if (limitSource) {
    parts.push(`(Source: ${limitSource})`);
  }

  if (remedy && remedy !== raw) {
    parts.push(`Remedy: ${String(remedy).trim()}`);
  }

  const body = parts.join(' ');
  return body ? `${prefix} ${body}` : `${prefix} ${message || 'Error'}`;
}
