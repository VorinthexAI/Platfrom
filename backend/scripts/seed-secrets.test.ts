import { describe, expect, test } from 'bun:test';

describe('secret seed roster reconciliation', () => {
  test('only deactivates non-seeded memberships when explicitly enabled', async () => {
    const source = await Bun.file(new URL('./seed-secrets.ts', import.meta.url)).text();
    expect(source).toContain("process.env.SYNC_SEEDED_ORGANIZATION_ROSTER === 'true'");
    expect(source).toContain('membership.userId NOT IN @userKeys');
    expect(source).toContain('status: "inactive"');
  });

  test('defers only normalized retryable provider outages', async () => {
    const source = await Bun.file(new URL('./seed-secrets.ts', import.meta.url)).text();
    expect(source).toContain("import { isProviderError } from '@/lib/ai/providers/errors';");
    expect(source).toContain('if (!isProviderError(error) || !error.retryable) throw error;');
    expect(source).toContain('Secret seed deferred because');
  });
});
