export const INSUFFICIENT_BALANCE_CODE = "INSUFFICIENT_BALANCE";
export const OUTSTANDING_DEBT_CODE = "OUTSTANDING_DEBT";

export const SPARK_FUNDING_COPY = {
  [INSUFFICIENT_BALANCE_CODE]: { title: "Not enough Sparks", description: "You need more Sparks to continue." },
  [OUTSTANDING_DEBT_CODE]: { title: "Spark spending paused", description: "Add Sparks to clear your outstanding balance and continue." },
} as const;

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

export function isSparkFundingError(value: unknown) {
  return sparkFundingUserCopy(value) !== undefined;
}

export function sparkFundingUserCopy(value: unknown) {
  const code = extractDomainErrorCode(value);
  if (code === OUTSTANDING_DEBT_CODE) return SPARK_FUNDING_COPY[OUTSTANDING_DEBT_CODE];
  if (code === INSUFFICIENT_BALANCE_CODE) return SPARK_FUNDING_COPY[INSUFFICIENT_BALANCE_CODE];
  const root = record(value);
  const message = responseErrorMessage(record(root?.response)?.data ?? value)
    ?? (value instanceof Error ? value.message : undefined);
  if (message === "billing.outstandingDebt") return SPARK_FUNDING_COPY[OUTSTANDING_DEBT_CODE];
  if (message === "billing.insufficientBalance") return SPARK_FUNDING_COPY[INSUFFICIENT_BALANCE_CODE];
}

function responseErrorMessage(payload: unknown) {
  const root = record(payload);
  if (typeof root?.error === "string") return root.error;
  if (typeof root?.message === "string") return root.message;
  const error = record(root?.error);
  return typeof error?.message === "string" ? error.message : undefined;
}

export function extractDomainErrorMessage(value: unknown): string | undefined {
  const funding = sparkFundingUserCopy(value);
  if (funding) return funding.description;
  const root = record(value);
  const response = record(root?.response);
  return responseErrorMessage(response?.data ?? value)
    ?? (value instanceof Error ? value.message : undefined);
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
  if (!isSparkFundingError(error)) return error;
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
