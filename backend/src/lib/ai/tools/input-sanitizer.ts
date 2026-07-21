import { z } from 'zod';

const ALLOWED_CHARACTERS = /[\p{L}\p{N}\s.,!?;:'"()[\]{}@#$%&*+\-=_/\\]/u;

export function sanitizeAgentInput(value: string): string {
  return Array.from(value.normalize('NFKC'))
    .filter((character) => ALLOWED_CHARACTERS.test(character))
    .join('')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const sanitizedAgentMessageSchema = z.string()
  .trim()
  .max(8_000)
  .transform(sanitizeAgentInput)
  .refine((value) => value.length > 0, 'message is empty after sanitization');
