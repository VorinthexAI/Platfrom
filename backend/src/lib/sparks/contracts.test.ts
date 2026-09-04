import { describe, expect, test } from 'bun:test';
import { sparkHistoryInputSchema, sparkMetadataSchema, sparkTransactionInputSchema, sparkTransactionSchema } from './contracts';

const base = {
  key: 'transaction-1',
  userKey: 'user-1',
  kind: 'tool' as const,
  deltaMicroSparks: -10,
  balanceAfterMicroSparks: 90,
  idempotencyKey: 'request-1',
  requestHash: '0123456789abcdef',
  toolSlug: 'document.create',
  createdAt: '2026-09-04T10:00:00.000Z',
};

describe('Spark contracts', () => {
  test('strictly validates immutable records and input fields', () => {
    expect(sparkTransactionSchema.parse(base)).toEqual(base);
    const { key: _key, balanceAfterMicroSparks: _balance, createdAt: _createdAt, ...input } = base;
    expect(sparkTransactionInputSchema.parse(input)).toEqual(input);
    expect(() => sparkTransactionSchema.parse({ ...base, scopeKey: 'scope-1' })).toThrow('Unrecognized key');
    expect(() => sparkTransactionInputSchema.parse({ ...input, deltaMicroSparks: 0 })).toThrow('nonzero');
    expect(() => sparkTransactionInputSchema.parse({ ...input, deltaMicroSparks: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
    expect(() => sparkTransactionInputSchema.parse({ ...input, toolSlug: 'document_create' })).toThrow('dotted slug');
  });

  test('bounds metadata and history requests', () => {
    expect(sparkMetadataSchema.parse({ provider: 'example', cached: false, units: 3 })).toEqual({ provider: 'example', cached: false, units: 3 });
    expect(() => sparkMetadataSchema.parse(Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`key${index}`, index])))).toThrow('20 entries');
    expect(() => sparkMetadataSchema.parse({ nested: { unsafe: true } })).toThrow();
    expect(sparkHistoryInputSchema.parse({})).toEqual({ limit: 50 });
    expect(sparkHistoryInputSchema.parse({ limit: 1 })).toEqual({ limit: 1 });
    expect(sparkHistoryInputSchema.parse({ limit: 200, beforeCreatedAt: base.createdAt, beforeKey: base.key })).toEqual({ limit: 200, beforeCreatedAt: base.createdAt, beforeKey: base.key });
    for (const limit of [0, 1.5, 201]) expect(() => sparkHistoryInputSchema.parse({ limit })).toThrow();
    expect(() => sparkHistoryInputSchema.parse({ beforeCreatedAt: base.createdAt })).toThrow('provided together');
    expect(() => sparkHistoryInputSchema.parse({ beforeKey: base.key })).toThrow('provided together');
    expect(() => sparkHistoryInputSchema.parse({ beforeCreatedAt: '2026-09-04', beforeKey: base.key })).toThrow();
    expect(() => sparkHistoryInputSchema.parse({ limit: 10, offset: 1 })).toThrow('Unrecognized key');
  });

  test('accepts canonical undotted action identifiers', () => {
    const { key: _key, balanceAfterMicroSparks: _balance, createdAt: _createdAt, toolSlug: _tool, ...input } = base;
    expect(sparkTransactionInputSchema.parse({ ...input, actionSlug: 'text' }).actionSlug).toBe('text');
    expect(() => sparkTransactionInputSchema.parse({ ...input, actionSlug: 'Bad.action' })).toThrow('canonical action slug');
  });

  test('accepts the product-neutral recurring service transaction kind', () => {
    expect(sparkTransactionSchema.parse({ ...base, kind: 'recurring-service', toolSlug: undefined }).kind).toBe('recurring-service');
  });
});
