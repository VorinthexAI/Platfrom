import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createArangoCheckoutHandoffRepository } from './checkout-handoffs-repository';

const cursor = (next?: unknown) => ({ async next() { return next; } });

describe('checkout handoff Arango repository', () => {
  test('claims one issuance identity atomically and reports deterministic duplicates', async () => {
    let query = '';
    const repository = createArangoCheckoutHandoffRepository({ async query(value) { query = value; return cursor('duplicate'); } });
    await expect(repository.issue({ key: newId(), tokenHash: 'a'.repeat(64), issuanceKey: 'b'.repeat(64), requestHash: 'c'.repeat(64), purpose: 'payment-checkout', userKey: newId(), productId: 'topup.small', checkoutIdempotencyKey: 'idem', expiresAt: '2026-09-05T11:00:00.000Z', claimLeaseKey: null, claimLeaseExpiresAt: null, consumedAt: null, checkoutKey: null, createdAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T10:00:00.000Z' }, '2026-09-05T10:00:00.000Z')).resolves.toBe('duplicate');
    expect(query).toContain('UPSERT { issuanceKey: @issuanceKey }');
    expect(query).toContain('OLD.requestHash == @requestHash');
  });
  test('atomically leases only an unexpired, unconsumed, unleased token', async () => {
    let query = ''; let binds: Record<string, unknown> = {};
    const repository = createArangoCheckoutHandoffRepository({ async query(value, input) { query = value; binds = input ?? {}; return cursor(); } });
    await expect(repository.claim('a'.repeat(64), newId(), '2026-09-05T10:00:00.000Z', '2026-09-05T10:05:00.000Z')).resolves.toBeNull();
    expect(query).toContain('handoff.expiresAt > @now && handoff.consumedAt == null');
    expect(query).toContain('handoff.claimLeaseKey == null || handoff.claimLeaseExpiresAt <= @now');
    expect(query.indexOf('UPDATE handoff')).toBeGreaterThan(query.indexOf('LIMIT 1'));
    expect(binds).toMatchObject({ tokenHash: 'a'.repeat(64) });
  });

  test('finalizes and releases only a matching lease', async () => {
    const queries: string[] = [];
    const repository = createArangoCheckoutHandoffRepository({ async query(value) { queries.push(value); return cursor(); } });
    await repository.consume('a'.repeat(64), newId(), newId(), '2026-09-05T10:00:00.000Z');
    await repository.release('a'.repeat(64), newId(), '2026-09-05T10:00:00.000Z');
    expect(queries[0]).toContain('handoff.claimLeaseKey == @leaseKey');
    expect(queries[0]).toContain('consumedAt: @now, checkoutKey: @checkoutKey');
    expect(queries[1]).toContain('handoff.claimLeaseKey == @leaseKey && handoff.consumedAt == null');
  });
});
