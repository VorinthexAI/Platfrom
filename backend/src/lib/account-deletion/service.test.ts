import { describe, expect, test } from 'bun:test';
import { createAccountDeletionService } from './service';

const userKey = 'cmrnlzf650002qc7k4p5zem5w';

function fixture(fences: Array<'fenced' | 'not_found' | 'shared_access' | 'active_checkout' | 'checkout_recovery_required'> = ['fenced']) {
  const calls: unknown[] = [];
  const repository = {
    fence: async () => {
      const status = fences.shift() ?? 'fenced';
      calls.push(['fence', status]);
      return status === 'fenced' ? { status, presenceSessionKeys: ['session-1'], recipient: { email: 'person@example.com' } } : { status };
    },
    finalize: async () => { calls.push(['finalize']); return { status: 'deleted' as const }; },
  };
  const commerce = {
    recoverUserPendingCheckouts: async () => { calls.push(['recover']); return { recovered: 1 }; },
    revokeUserSubscriptions: async () => { calls.push(['revoke']); return { revoked: 1 }; },
  };
  const invalidateSessions = async (key: string, sessions: string[]) => { calls.push(['invalidate', key, sessions]); };
  const sendDeletedEmail = async (email: string) => { calls.push(['email', email]); };
  return { calls, service: createAccountDeletionService({ repository, commerce, invalidateSessions, sendDeletedEmail }) };
}

describe('canonical account deletion service', () => {
  test('orders short fence, unlocked external work, then atomic final teardown', async () => {
    const context = fixture();
    await expect(context.service.delete({ confirmation: 'DELETE MY ACCOUNT' }, userKey)).resolves.toEqual({ deleted: true });
    expect(context.calls).toEqual([
      ['fence', 'fenced'], ['revoke'], ['invalidate', userKey, ['session-1']], ['finalize'], ['email', 'person@example.com'],
    ]);
  });

  test('never performs commerce reads while either deletion transaction is active', async () => {
    let transactionActive = false;
    const calls: string[] = [];
    const repository = {
      fence: async () => { transactionActive = true; calls.push('fence-transaction'); await Promise.resolve(); transactionActive = false; return { status: 'fenced' as const, presenceSessionKeys: [], recipient: { email: 'person@example.com' } }; },
      finalize: async () => { transactionActive = true; calls.push('final-transaction'); await Promise.resolve(); transactionActive = false; return { status: 'deleted' as const }; },
    };
    const commerce = {
      recoverUserPendingCheckouts: async () => ({ recovered: 0 }),
      revokeUserSubscriptions: async () => { expect(transactionActive).toBe(false); calls.push('commerce-read-and-revoke'); return { revoked: 0 }; },
    };
    const service = createAccountDeletionService({ repository, commerce, invalidateSessions: async () => { expect(transactionActive).toBe(false); calls.push('redis-fence'); }, sendDeletedEmail: async () => { expect(transactionActive).toBe(false); calls.push('email'); } });
    await service.delete({ confirmation: 'DELETE MY ACCOUNT' }, userKey);
    expect(calls).toEqual(['fence-transaction', 'commerce-read-and-revoke', 'redis-fence', 'final-transaction', 'email']);
  });

  test('recovers stale pending checkouts canonically before trying to fence again', async () => {
    const context = fixture(['checkout_recovery_required', 'active_checkout']);
    await expect(context.service.delete({ confirmation: 'DELETE MY ACCOUNT' }, userKey)).rejects.toMatchObject({ code: 'ACCOUNT_ACTIVE_CHECKOUT' });
    expect(context.calls).toEqual([['fence', 'checkout_recovery_required'], ['recover'], ['fence', 'active_checkout']]);
  });

  test('blocks shared accounts and live checkouts before external side effects', async () => {
    for (const [status, code] of [['shared_access', 'ACCOUNT_SHARED_ACCESS'], ['active_checkout', 'ACCOUNT_ACTIVE_CHECKOUT']] as const) {
      const context = fixture([status]);
      await expect(context.service.delete({ confirmation: 'DELETE MY ACCOUNT' }, userKey)).rejects.toMatchObject({ code });
      expect(context.calls).toEqual([['fence', status]]);
    }
  });

  test('keeps the durable fence when provider or Redis preparation fails so retry remains fail-closed', async () => {
    for (const failure of ['provider', 'redis'] as const) {
      let finalized = false;
      const repository = { fence: async () => ({ status: 'fenced' as const, presenceSessionKeys: ['session-1'], recipient: { email: 'person@example.com' } }), finalize: async () => { finalized = true; return { status: 'deleted' as const }; } };
      const commerce = { recoverUserPendingCheckouts: async () => ({ recovered: 0 }), revokeUserSubscriptions: async () => { if (failure === 'provider') throw new Error('provider unavailable'); return { revoked: 0 }; } };
      const service = createAccountDeletionService({ repository, commerce, invalidateSessions: async () => { if (failure === 'redis') throw new Error('redis unavailable'); }, sendDeletedEmail: async () => undefined });
      await expect(service.delete({ confirmation: 'DELETE MY ACCOUNT' }, userKey)).rejects.toThrow(`${failure} unavailable`);
      expect(finalized).toBe(false);
    }
  });

  test('requires strict confirmation and treats an authenticated canonical retry as deleted', async () => {
    const invalid = fixture();
    await expect(invalid.service.delete({ confirmation: 'DELETE MY ACCOUNT', userKey }, userKey)).rejects.toThrow();
    expect(invalid.calls).toEqual([]);
    const retry = fixture(['not_found']);
    await expect(retry.service.delete({ confirmation: 'DELETE MY ACCOUNT' }, userKey)).resolves.toEqual({ deleted: true });
    expect(retry.calls).toEqual([['fence', 'not_found']]);
  });

  test('suppresses deletion confirmation for provider bounce cleanup', async () => {
    const context = fixture();
    await expect(context.service.delete({ confirmation: 'DELETE MY ACCOUNT' }, userKey, { sendConfirmation: false })).resolves.toEqual({ deleted: true });
    expect(context.calls).not.toContainEqual(['email', 'person@example.com']);
    expect(context.calls.at(-1)).toEqual(['finalize']);
  });
});
