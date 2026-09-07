import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const EVENT_IDENTIFIER_HEADER = 'X-Vorinthex-Event-Identifier';
export const eventIdentifierSchema = z.string().regex(/^[a-f0-9]{128}$/);

const storage = new AsyncLocalStorage<string>();

export function currentEventIdentifier(): string | null {
  return storage.getStore() ?? null;
}

export function runWithEventIdentifier<T>(eventIdentifier: string, execute: () => T): T {
  return storage.run(eventIdentifierSchema.parse(eventIdentifier), execute);
}

export function createEventIdentifier(): string {
  return randomBytes(64).toString('hex');
}
