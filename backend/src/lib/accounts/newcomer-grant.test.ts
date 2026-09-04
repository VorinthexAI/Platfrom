import { describe, expect, test } from 'bun:test';
import { newcomerGrantInput } from './service';

describe('new account newcomer grant', () => {
  test('uses a distinct idempotent v2 identity for exactly 100 Sparks', () => {
    expect(newcomerGrantInput('event')).toEqual({
      deltaMicroSparks: 100_000_000,
      idempotencyKey: 'account-grant:v2',
      requestHash: 'account-grant:v2:100-sparks',
      eventKey: 'event',
      metadata: { category: 'newcomer-grant', grantVersion: 'v2' },
    });
  });

  test('does not run new-account initialization from the existing-account reconciliation branch', async () => {
    const source = await Bun.file(new URL('./service.ts', import.meta.url)).text();
    const start = source.indexOf('async function reconcileWithExisting');
    const reconcile = source.slice(start, source.indexOf('const existing =', start));
    expect(reconcile).not.toContain('sparkService.adjust');
    expect(reconcile).toContain('recoverNewcomerGrantEvent');
    expect(source).toContain('return initializeNewAccount(await getUserById(user.key) ?? user)');
  });
});
