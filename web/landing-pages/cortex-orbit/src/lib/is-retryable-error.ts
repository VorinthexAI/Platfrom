import { isAxiosError } from "axios";

/**
 * Shared TanStack Query retry predicate. 4xx responses (bad request, auth,
 * not-found) are never worth retrying; network errors and 5xx responses are.
 */
export function isRetryableError(error: unknown): boolean {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status === undefined) return true;
    return status >= 500;
  }
  if (error instanceof Response) {
    return error.status >= 500;
  }
  return true;
}
