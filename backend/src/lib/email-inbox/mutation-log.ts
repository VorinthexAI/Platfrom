import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { GmailApiError } from './gmail';

export const EMAIL_MUTATION_LOG_PATH = process.env.EMAIL_MUTATION_LOG_PATH || '/tmp/email-mutations.txt';

function describeError(error: unknown) {
  if (error instanceof GmailApiError) {
    return { name: error.name, message: error.message, status: error.status, reasons: error.reasons, providerStatus: error.metadata.providerStatus, providerMessage: error.metadata.providerMessage };
  }
  if (error instanceof Error) {
    const extra = error as Error & { errorNum?: number; code?: string | number };
    return { name: error.name, message: error.message, ...(extra.errorNum != null ? { errorNum: extra.errorNum } : {}), ...(extra.code != null ? { code: extra.code } : {}) };
  }
  return { message: String(error) };
}

export function logEmailMutation(event: string, fields: Record<string, unknown> = {}) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`;
  void mkdir(dirname(EMAIL_MUTATION_LOG_PATH), { recursive: true }).then(() => appendFile(EMAIL_MUTATION_LOG_PATH, line)).catch(() => undefined);
  console.error(`email-mutation ${event}`, fields);
}

export function logEmailMutationError(event: string, error: unknown, fields: Record<string, unknown> = {}) {
  logEmailMutation(event, { ...fields, error: describeError(error) });
}
