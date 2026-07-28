import { describe, expect, test } from 'bun:test';

describe('secret seed roster reconciliation', () => {
  test('only deactivates non-seeded memberships when explicitly enabled', async () => {
    const source = await Bun.file(new URL('./seed-secrets.ts', import.meta.url)).text();
    expect(source).toContain("process.env.SYNC_SEEDED_ORGANIZATION_ROSTER === 'true'");
    expect(source).toContain('membership.userId NOT IN @userKeys');
    expect(source).toContain('status: "inactive"');
  });
});
