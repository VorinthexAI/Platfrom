import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { findWorkspaceGraph } from './graph-query';

const userKey = newId(), teamKey = newId(), scopeKey = newId(), imageKey = newId();
const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId(), teamKey, userId: userKey, status: 'active' } } } as any;

describe('native workspace search', () => {
  test('searches only the current scope and returns references without raw document contents', async () => {
    let queryText = ''; let bind: Record<string, unknown> = {};
    const hits = await findWorkspaceGraph('red boat', context, 10, {
      authorize: async () => ({ allowed: true }) as never,
      database: { query: async (query: string, vars: Record<string, unknown>) => {
        queryText = query; bind = vars;
        return { all: async () => [{ source: 'images', document: { _key: imageKey, caption: 'Red boat', storageKey: 'private/secret', embedding: [1] } }] };
      } } as never,
    });
    expect(queryText).toContain('SEARCH ANALYZER(');
    expect(queryText).toContain('waitForSync: true');
    expect(queryText).toContain('resource.scopeKey == @scopeKey');
    expect(queryText).toContain('resource.userKey == @userKey AND source IN @privateSources');
    expect(bind).toMatchObject({ scopeKey, scopeKeys: [scopeKey, userKey], userKey, teamKey, text: 'red boat', limit: 10 });
    expect(hits).toEqual([{ source: 'images', key: imageKey, label: 'Red boat' }]);
    expect(JSON.stringify(hits)).not.toContain('private/secret');
  });

  test('does not query the index when scope access was revoked', async () => {
    let queried = false;
    await expect(findWorkspaceGraph('boat', context, 1, { authorize: async () => ({ allowed: false }) as never, database: { query: async () => { queried = true; } } as never })).rejects.toThrow('Scope access denied');
    expect(queried).toBe(false);
  });

  test('resolves storage links into typed file and email thread references', async () => {
    const fileKey = newId(), threadKey = newId();
    const hits = await findWorkspaceGraph('receipt', context, 10, {
      authorize: async () => ({ allowed: true }) as never,
      database: { query: async () => ({ all: async () => [
        { source: 'documents', document: { _key: fileKey, name: 'Receipt.pdf', extension: 'pdf' } },
        { source: 'emailMessages', document: { _key: newId(), subject: 'Receipt', threadKey } },
      ] }) } as never,
    });
    expect(hits).toEqual([
      { source: 'documents', key: fileKey, label: 'Receipt.pdf', resourceHint: 'files' },
      { source: 'emailMessages', key: threadKey, label: 'Receipt' },
    ]);
  });
});
