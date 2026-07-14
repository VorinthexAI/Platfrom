/**
 * Base error for the whole AI execution layer. Every typed error carries a
 * stable machine-readable `code` (never a secret, credential, or raw
 * provider payload) so callers can branch deterministically.
 */
export class AiError extends Error {
  readonly code: string;
  /** Whether trying an alternative route could plausibly succeed. */
  readonly retryable: boolean;

  constructor(code: string, message: string, options?: { retryable?: boolean; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export function isAiError(err: unknown): err is AiError {
  return err instanceof AiError;
}

/** Minimal discriminated result, used for fallback-attempt bookkeeping. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}
