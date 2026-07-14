import { AiError } from '@/lib/ai/shared/result';
import type { ProviderId } from './types';

/**
 * Stable, provider-independent error codes. `retryable` on the error means
 * "another route could plausibly succeed" — it does NOT by itself permit a
 * fallback for non-idempotent actions (see router/execute-route.ts).
 */
export const PROVIDER_ERROR_CODES = [
  'authentication_failed',
  'rate_limited',
  'provider_unavailable',
  'timeout',
  'aborted',
  'invalid_input',
  'unsupported_action',
  'not_configured',
  'response_invalid',
  'unknown',
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

const RETRYABLE_CODES: ReadonlySet<ProviderErrorCode> = new Set([
  'authentication_failed',
  'rate_limited',
  'provider_unavailable',
  'timeout',
  'not_configured',
  'response_invalid',
]);

/**
 * Codes that provably occur BEFORE the provider executed anything — no
 * billable output can exist, so falling back is safe even for
 * non-idempotent actions like image or video generation.
 */
export const PRE_EXECUTION_ERROR_CODES: ReadonlySet<ProviderErrorCode> = new Set([
  'authentication_failed',
  'rate_limited',
  'provider_unavailable',
  'not_configured',
  'unsupported_action',
  'invalid_input',
]);

export class ProviderError extends AiError {
  readonly providerId: ProviderId;
  readonly status?: number;

  declare readonly code: ProviderErrorCode;

  constructor(
    providerId: ProviderId,
    code: ProviderErrorCode,
    message: string,
    options?: { status?: number; retryable?: boolean; cause?: unknown },
  ) {
    super(code, message, {
      retryable: options?.retryable ?? RETRYABLE_CODES.has(code),
      cause: options?.cause,
    });
    this.providerId = providerId;
    this.status = options?.status;
  }
}

export function isProviderError(err: unknown): err is ProviderError {
  return err instanceof ProviderError;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError');
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'APIConnectionTimeoutError');
}

/** Maps an HTTP status to the normalized error code shared by every adapter. */
export function providerErrorCodeForStatus(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return 'authentication_failed';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_unavailable';
  if (status === 400 || status === 404 || status === 422) return 'invalid_input';
  return 'unknown';
}

/**
 * Converts whatever an SDK or fetch call threw into a `ProviderError`. The
 * original error is preserved as `cause`, but the normalized message never
 * embeds credentials or raw payloads.
 */
export function normalizeProviderError(providerId: ProviderId, err: unknown): ProviderError {
  if (isProviderError(err)) return err;
  if (isAbortError(err)) {
    return new ProviderError(providerId, 'aborted', `${providerId} request aborted`, { cause: err });
  }
  if (isTimeoutError(err)) {
    return new ProviderError(providerId, 'timeout', `${providerId} request timed out`, { cause: err });
  }
  const status =
    typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : undefined;
  if (status !== undefined) {
    const code = providerErrorCodeForStatus(status);
    return new ProviderError(providerId, code, `${providerId} request failed with status ${status}`, { status, cause: err });
  }
  const message = err instanceof Error ? err.message : 'unknown error';
  return new ProviderError(providerId, 'unknown', `${providerId} request failed: ${message}`, { cause: err });
}
