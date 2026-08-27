import { createHash } from 'node:crypto';

export function emailInboxKey(scopeKey: string, connectorKey: string) {
  // Preserve the key algorithm used by existing canonical inbox records.
  return `c${createHash('sha256').update(`managed-mail-folder\0${scopeKey}\0mail-inbox\0${connectorKey}`).digest('hex').slice(0, 24)}`;
}
