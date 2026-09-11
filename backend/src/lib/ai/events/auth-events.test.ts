import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { authCompletionSlug, recordAuthCompletion } from './auth-events';

describe('auth completion events', () => {
  test('uses provider and account state in fixed event slugs', () => {
    expect(authCompletionSlug('google', false)).toBe('auth.completed.google.sign-up');
    expect(authCompletionSlug('google', true)).toBe('auth.completed.google.sign-in');
    expect(authCompletionSlug('apple', false)).toBe('auth.completed.apple.sign-up');
    expect(authCompletionSlug('email', true)).toBe('auth.completed.email.sign-in');
  });

  test('records successful auth against the authenticated user and current product', async () => {
    const appScopeKey = newId();
    const calls: unknown[] = [];
    await recordAuthCompletion({ method: 'apple', userKey: 'user-1', scopeKey: 'scope-1', wasVerified: false }, {
      getAppScopeKey: () => appScopeKey,
      record: async (input) => { calls.push(input); },
    });

    expect(calls).toEqual([{
      userId: 'user-1',
      scopeKey: 'scope-1',
      slug: 'auth.completed.apple.sign-up',
      appScopeKey,
    }]);
  });

  test('does not fail authentication when analytics recording fails', async () => {
    const warnings: unknown[][] = [];
    await expect(recordAuthCompletion({ method: 'email', userKey: 'user-1', scopeKey: 'scope-1', wasVerified: true }, {
      getAppScopeKey: () => newId(),
      record: async () => { throw new Error('events unavailable'); },
      warn: (...args) => { warnings.push(args); },
    })).resolves.toBeUndefined();
    expect(warnings[0]).toContain('events unavailable');
  });
});
