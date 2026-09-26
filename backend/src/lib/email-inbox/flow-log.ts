import { appendFile } from 'node:fs/promises';

export function emailFlowLogPath() {
  return process.env.EMAIL_FLOW_LOG_PATH?.trim() || '/tmp/vorinthex-email-flow.txt';
}

const SECRET = /access[_-]?token|refresh[_-]?token|authorization|bearer |vrtx_email_grant_|vrtx_email_state_|verifier|password|secret|ciphertext|encryptedcredentials/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value ?? null;
  if (typeof value === 'string') {
    if (SECRET.test(value) || value.length > 500) return `[redacted:${value.length}]`;
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return { name: value.name, message: SECRET.test(value.message) ? '[redacted]' : value.message.slice(0, 400) };
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 80).map(([key, item]) => [key, SECRET.test(key) ? '[redacted]' : sanitize(item, depth + 1)]));
  }
  return String(value);
}

export function logEmailFlow(event: string, details: Record<string, unknown> = {}) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), event, ...sanitize(details) as object })}\n`;
  console.warn(`email-flow ${line.trim()}`);
  void appendFile(emailFlowLogPath(), line).catch(() => undefined);
}
