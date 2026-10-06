import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const LOG_PATH = process.env.ACCOUNT_DELETION_LOG_PATH ?? '/tmp/vorinthex-account-deletion.log';

export function serializeDeletionError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: String(error) };
}

export function logAccountDeletion(event: string, details: Record<string, unknown> = {}) {
  const line = `${JSON.stringify({ ts: new Date().toISOString(), event, ...details })}\n`;
  console.info('account-deletion', { event, ...details });
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, line);
  } catch (error) {
    console.error('account-deletion log write failed', { path: LOG_PATH, error: serializeDeletionError(error) });
  }
}
