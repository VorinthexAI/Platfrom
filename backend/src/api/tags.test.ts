import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { runTool } from '@/lib/ai/tools';
import { ScopeTagError } from '@/lib/scope-tags/service';
import { createTagHandlers, type TagHandlerDependencies } from './tags';

const organizationKey = 'organization';
const scopeKey = newId();
const userKey = newId();
const tagKey = newId();
const targetKey = newId();
const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;

function appWith(dependencies: TagHandlerDependencies) {
  const handlers = createTagHandlers(dependencies);
  return new Hono()
    .post('/tags/list', handlers.list)
    .post('/tags', handlers.create)
    .patch('/tags/:tagKey', handlers.update)
    .delete('/tags/:tagKey', handlers.delete)
    .post('/tags/assignments', handlers.assignments);
}

const request = (app: Hono, path: string, body: unknown, method = 'POST') => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const dependencies = (service: TagHandlerDependencies['service']): TagHandlerDependencies => ({
  service,
  getIdentity: async () => ({ key: userKey, identityType: 'user' }),
  authorize: async (selector, options) => {
    expect(selector).toEqual({ organizationKey, scopeKey });
    expect(options.authenticatedUserKey).toBe(userKey);
    return { context };
  },
});

describe('tag HTTP and unified integrations', () => {
  test('routes strict CRUD requests to the canonical service with trusted context', async () => {
    const calls: unknown[][] = [];
    const service = {
      list: async (...args: unknown[]) => { calls.push(['list', ...args]); return { items: [], nextCursor: null }; },
      create: async (...args: unknown[]) => { calls.push(['create', ...args]); return { key: tagKey, name: 'Plan' }; },
      update: async (...args: unknown[]) => { calls.push(['update', ...args]); return { key: tagKey, name: 'Roadmap' }; },
      delete: async (...args: unknown[]) => { calls.push(['delete', ...args]); return { deletedKey: tagKey }; },
      setAssignments: async () => ({ changes: [], changedCount: 0, assignedChanged: 0, unassignedChanged: 0 }),
    } as any;
    const app = appWith(dependencies(service));
    expect((await request(app, '/tags/list', { organizationKey, scopeKey, limit: 10 })).status).toBe(200);
    expect((await request(app, '/tags', { organizationKey, scopeKey, key: tagKey, name: ' Plan ' })).status).toBe(201);
    expect((await request(app, `/tags/${tagKey}`, { organizationKey, scopeKey, name: 'Roadmap' }, 'PATCH')).status).toBe(200);
    expect((await request(app, `/tags/${tagKey}`, { organizationKey, scopeKey }, 'DELETE')).status).toBe(200);
    expect(calls).toEqual([
      ['list', { limit: 10 }, context],
      ['create', { key: tagKey, name: 'Plan' }, context],
      ['update', { tagKey, name: 'Roadmap' }, context],
      ['delete', { tagKey }, context],
    ]);
  });

  test('rejects unknown, forged, duplicate, invalid-action, and oversized assignment input', async () => {
    let calls = 0;
    const service = new Proxy({}, { get: () => async () => { calls += 1; return {}; } }) as any;
    const app = appWith(dependencies(service));
    expect((await request(app, '/tags/list', { organizationKey, scopeKey, membershipKey: newId() })).status).toBe(400);
    expect((await request(app, '/tags', { organizationKey, scopeKey, name: 'x', userKey })).status).toBe(400);
    expect((await request(app, `/tags/${tagKey}`, { organizationKey, scopeKey, name: 'x', tagKey }, 'PATCH')).status).toBe(400);
    expect((await request(app, `/tags/${tagKey}`, { organizationKey, scopeKey }, 'PATCH')).status).toBe(400);
    expect((await request(app, `/tags/${tagKey}`, { organizationKey, scopeKey, name: 42 }, 'PATCH')).status).toBe(400);
    expect((await request(app, `/tags/${tagKey}`, { organizationKey, scopeKey, source: 'ai' }, 'DELETE')).status).toBe(400);
    const target = { type: 'document', key: targetKey };
    expect((await request(app, '/tags/assignments?action=tag', { organizationKey, scopeKey, targets: [target, target], tagKeys: [tagKey] })).status).toBe(400);
    expect((await request(app, '/tags/assignments?action=tag', { organizationKey, scopeKey, targets: [target], tagKeys: [tagKey, tagKey] })).status).toBe(400);
    expect((await request(app, '/tags/assignments?action=tag', { organizationKey, scopeKey, targets: [target], tagKeys: [tagKey], source: 'ai' })).status).toBe(400);
    expect((await request(app, '/tags/assignments?action=replace', { organizationKey, scopeKey, targets: [target], tagKeys: [tagKey] })).status).toBe(400);
    expect((await request(app, '/tags/assignments?action=tag&source=ai', { organizationKey, scopeKey, targets: [target], tagKeys: [tagKey] })).status).toBe(400);
    expect((await request(app, '/tags/assignments?action=tag', { organizationKey, scopeKey, targets: Array.from({ length: 11 }, () => ({ type: 'document', key: newId() })), tagKeys: Array.from({ length: 10 }, () => newId()) })).status).toBe(400);
    expect(calls).toBe(0);
  });

  test('expands HTTP desired state and preserves HTTP/Core source parity', async () => {
    const calls: unknown[][] = [];
    const service = { setAssignments: async (...args: unknown[]) => { calls.push(args); return { changes: [], changedCount: 0, assignedChanged: 0, unassignedChanged: 0 }; } } as any;
    const app = appWith(dependencies(service));
    const image = { type: 'image', key: newId() } as const;
    const document = { type: 'document', key: targetKey } as const;
    const secondTagKey = newId();
    expect((await request(app, '/tags/assignments?action=untag', { organizationKey, scopeKey, targets: [document, image], tagKeys: [tagKey, secondTagKey] })).status).toBe(200);
    await runTool('tag.assignment.set', '', { changes: [{ tagKey, target: document, assigned: true }] }, { contentContext: context, scopeTagService: service });
    expect(calls[0]).toEqual([{ changes: [
      { tagKey, target: document, assigned: false }, { tagKey: secondTagKey, target: document, assigned: false },
      { tagKey, target: image, assigned: false }, { tagKey: secondTagKey, target: image, assigned: false },
    ] }, context, { source: 'user' }]);
    expect(calls[1]).toEqual([{ changes: [{ tagKey, target: document, assigned: true }] }, context, { source: 'ai' }]);
  });

  test('applies one Archive assignment across heterogeneous folder, document, and file targets', async () => {
    const calls: unknown[][] = [];
    const service = { setAssignments: async (...args: unknown[]) => { calls.push(args); return { changes: [], changedCount: 0, assignedChanged: 0, unassignedChanged: 0 }; } } as any;
    const folder = { type: 'folder' as const, key: newId() };
    const authoredDocument = { type: 'document' as const, key: newId() };
    const uploadedFile = { type: 'document' as const, key: newId() };
    const response = await request(appWith(dependencies(service)), '/tags/assignments?action=tag', { organizationKey, scopeKey, targets: [folder, authoredDocument, uploadedFile], tagKeys: [tagKey] });
    expect(response.status).toBe(200);
    expect(calls).toEqual([[{ changes: [
      { tagKey, target: folder, assigned: true },
      { tagKey, target: authoredDocument, assigned: true },
      { tagKey, target: uploadedFile, assigned: true },
    ] }, context, { source: 'user' }]]);
  });

  test('routes distinct batch-list targets and preserves the additive response shape', async () => {
    const document = { type: 'document' as const, key: targetKey }, book = { type: 'book' as const, key: newId() };
    const responseBody = { items: [{ key: tagKey, name: 'Plan' }], nextCursor: null, targetAssignments: [{ target: document, tagKeys: [tagKey] }, { target: book, tagKeys: [] }] };
    const calls: unknown[][] = [];
    const service = { list: async (...args: unknown[]) => { calls.push(args); return responseBody; } } as any;
    const response = await request(appWith(dependencies(service)), '/tags/list', { organizationKey, scopeKey, targets: [document, book], limit: 25 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: responseBody });
    expect(calls).toEqual([[{ targets: [document, book], limit: 25 }, context]]);
  });

  test('strictly rejects duplicate, ambiguous, empty, oversized, and unknown batch-list transport input', async () => {
    let calls = 0;
    const app = appWith(dependencies({ list: async () => { calls += 1; return { items: [], nextCursor: null }; } } as any));
    const target = { type: 'document', key: targetKey };
    expect((await request(app, '/tags/list', { organizationKey, scopeKey, targets: [target, target] })).status).toBe(400);
    expect((await request(app, '/tags/list', { organizationKey, scopeKey, target, targets: [target] })).status).toBe(400);
    expect((await request(app, '/tags/list', { organizationKey, scopeKey, targets: [] })).status).toBe(400);
    expect((await request(app, '/tags/list', { organizationKey, scopeKey, targets: Array.from({ length: 101 }, () => ({ type: 'document', key: newId() })) })).status).toBe(400);
    expect((await request(app, '/tags/list', { organizationKey, scopeKey, targets: [target], assignmentMode: 'direct' })).status).toBe(400);
    expect(calls).toBe(0);
  });

  test('returns nondisclosing not-found for an unauthorized batch-list target', async () => {
    const service = { list: async () => { throw new ScopeTagError('NOT_FOUND', 'Target not found.'); } } as any;
    const response = await request(appWith(dependencies(service)), '/tags/list', { organizationKey, scopeKey, targets: [{ type: 'book', key: newId() }] });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: { code: 'TAG_NOT_FOUND', message: 'Target not found.' } });
  });
});
