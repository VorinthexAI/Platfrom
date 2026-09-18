import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { createWorkspacePickerHandlers } from './workspace-picker';

const signalKey = newId();

describe('PATCH /auth/me/workspace-apps', () => {
  test('updates the picker through the canonical service and rejects unknown fields', async () => {
    const calls: unknown[] = [];
    const app = new Hono().patch('/auth/me/workspace-apps', createWorkspacePickerHandlers({
      getIdentity: async () => ({ key: 'user-1', identityType: 'user' }),
      getContext: async () => ({ team: { key: 'team-1' }, membership: { key: 'membership-1' } }) as never,
      service: {
        read: async () => ({ apps: [], selectedScopeKeys: null }),
        update: async (userKey, scopeKeys) => {
          calls.push({ userKey, scopeKeys });
          return { apps: [{ scopeKey: signalKey, slug: 'signal', name: 'Signal' }], selectedScopeKeys: [signalKey] };
        },
      },
    }).update);

    const response = await app.request('/auth/me/workspace-apps', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scopeKeys: [signalKey] }),
    });
    expect(response.status).toBe(200);
    expect(calls).toEqual([{ userKey: 'user-1', scopeKeys: [signalKey] }]);
    expect(await response.json()).toEqual({ apps: [{ scopeKey: signalKey, slug: 'signal', name: 'Signal' }], selectedScopeKeys: [signalKey] });

    expect((await app.request('/auth/me/workspace-apps', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scopeKeys: [signalKey], userKey: 'forged' }),
    })).status).toBe(400);
  });
});
