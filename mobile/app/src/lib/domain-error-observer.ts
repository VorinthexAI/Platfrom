export const INSUFFICIENT_BALANCE_CODE = "INSUFFICIENT_BALANCE";

type DomainErrorListener = (error: unknown) => void;
const listeners = new Set<DomainErrorListener>();
const observedErrors = new WeakSet<object>();

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

export function extractDomainErrorCode(value: unknown): string | undefined {
  const root = record(value);
  const response = record(root?.response);
  const payload = record(response?.data) ?? root;
  const error = record(payload?.error);
  const data = record(payload?.data);
  const dataError = record(data?.error);
  return [error?.code, payload?.code, dataError?.code, data?.code]
    .find((candidate): candidate is string => typeof candidate === "string");
}

export function isInsufficientBalanceError(value: unknown) {
  return extractDomainErrorCode(value) === INSUFFICIENT_BALANCE_CODE;
}

function responseErrorMessage(payload: unknown) {
  const root = record(payload);
  if (typeof root?.error === "string") return root.error;
  if (typeof root?.message === "string") return root.message;
  const error = record(root?.error);
  return typeof error?.message === "string" ? error.message : undefined;
}

export function createObservedHttpError(status: number, responseText: string) {
  let data: unknown;
  try { data = JSON.parse(responseText); } catch { data = undefined; }
  return observeDomainError(Object.assign(
    new Error(responseErrorMessage(data) ?? `Streaming request failed with status ${status}.`),
    { response: { data, status } },
  ));
}

export function observeDomainError<T>(error: T): T {
  if (!isInsufficientBalanceError(error)) return error;
  if (typeof error === "object" && error !== null) {
    if (observedErrors.has(error)) return error;
    observedErrors.add(error);
  }
  for (const listener of listeners) listener(error);
  return error;
}

export function rejectObservedDomainError(error: unknown): Promise<never> {
  observeDomainError(error);
  return Promise.reject(error);
}

export function subscribeDomainErrors(listener: DomainErrorListener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
