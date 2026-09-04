import { describe, expect, test } from 'bun:test';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { tagSchema, type Tag } from '@/lib/db/tags.node';
import { createScopeTagService, normalizeScopeTagName, scopeTagServiceSchemas } from './service';
import { ScopeTagRepositoryError, type ScopeTagRepository } from './repository';

const organizationKey = newId(), scopeKey = newId(), userKey = newId(), membershipKey = newId(), timestamp = '2026-09-04T12:00:00.000Z';
const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: membershipKey, userId: userKey, organizationId: organizationKey, status: 'active' }, scopeMember: { role: 'viewer', status: 'active' } } } as unknown as ToolContext;
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);

function memoryRepository() {
  const tags: Tag[] = [];
  const assignments = new Set<string>();
  const sources: string[] = [];
  const repository: ScopeTagRepository = {
    async list(owner, input) { return tags.filter((tag) => tag.scopeKey === owner.scopeKey && tag.userKey === owner.userKey && (!input.target || assignments.has(`${tag.key}:${input.target.type}:${input.target.key}`))).sort((a, b) => a.normalizedName.localeCompare(b.normalizedName) || a.key.localeCompare(b.key)).slice(0, input.limit); },
    async get(owner, key) { return tags.find((tag) => tag.key === key && tag.scopeKey === owner.scopeKey && tag.userKey === owner.userKey) ?? null; },
    async resolveOwnedByNormalizedNames(owner, names) { return tags.filter((tag) => tag.scopeKey === owner.scopeKey && tag.userKey === owner.userKey && names.includes(tag.normalizedName)); },
    async searchOwned(owner, _embedding, limit) { return tags.filter((tag) => tag.scopeKey === owner.scopeKey && tag.userKey === owner.userKey).slice(0, limit).map((tag, index) => ({ ...tag, score: 1 - index / 100 })); },
    async create(_owner, tag) { tags.push(tag); return tag; },
    async update(_owner, key, patch) { const index = tags.findIndex((tag) => tag.key === key); if (index < 0) return null; const value = { ...tags[index], ...patch } as Record<string, unknown>; if (value.description === null) delete value.description; tags[index] = tagSchema.parse(value); return tags[index]!; },
    async delete(_owner, key) { const index = tags.findIndex((tag) => tag.key === key); if (index < 0) return false; tags.splice(index, 1); return true; },
    async setAssignments(_owner, changes, source) { sources.push(source); return changes.map((change) => { const tuple = `${change.tagKey}:${change.target.type}:${change.target.key}`; const before = assignments.has(tuple); change.assigned ? assignments.add(tuple) : assignments.delete(tuple); return { assignment: null, changed: before !== change.assigned }; }); },
    async resolveCandidateKeys(_owner, tagKeys, targetTypes, match) { return Object.fromEntries(targetTypes.map((type) => [type, [...assignments].filter((tuple) => tagKeys[match === 'all' ? 'every' : 'some']((tagKey) => tuple.startsWith(`${tagKey}:${type}:`))).map((tuple) => tuple.split(':').at(-1)!)])); },
    async resolveEmailThreadKeys() { return []; },
    async rankCandidateKeys(_owner, _targetType, candidateKeys) { return candidateKeys.map((key, index) => ({ key, score: 1 - index / 100 })); },
    async listTargetTags() { return {}; },
    async listTargetAssignmentState(_owner, targets, tagKeys) { return targets.map((target) => ({ target, tagKeys: tagKeys.filter((tagKey) => assignments.has(`${tagKey}:${target.type}:${target.key}`)) })); },
    async listAssignments() { return []; },
    async countAssignments() { return 0; },
    async getAssignment() { return null; },
  };
  return { repository, tags, assignments, sources };
}

describe('scope tag service', () => {
  test('normalizes names and descriptions, embeds normalized semantic text, and omits private fields', async () => {
    const memory = memoryRepository(); const texts: string[] = [];
    const service = createScopeTagService({ repository: memory.repository, embed: async ({ text }) => { texts.push(text); return embedding; }, now: () => timestamp, id: newId });
    const clientKey = newId();
    const result = await service.create({ key: clientKey, name: '  Ｆoo   BAR ', description: '  Useful\n details  ' }, context);
    expect(normalizeScopeTagName('  Ｆoo   BAR ')).toBe('foo bar');
    expect(texts).toEqual(['foo bar\n\nUseful details']);
    expect(result).toEqual(expect.objectContaining({ key: clientKey, name: 'Foo BAR', description: 'Useful details' }));
    for (const field of ['scopeKey', 'userKey', 'normalizedName', 'embedding']) expect(result).not.toHaveProperty(field);
    expect(memory.tags[0]).toMatchObject({ scopeKey, userKey, normalizedName: 'foo bar' });
    expect(await service.create({ key: clientKey, name: 'Foo BAR', description: 'Useful details' }, context)).toEqual(result);
    expect(texts).toHaveLength(1);
  });

  test('uses desired-state assignment order, mixed counts, and service-injected source', async () => {
    const memory = memoryRepository(), service = createScopeTagService({ repository: memory.repository, embed: async () => embedding, now: () => timestamp });
    const tag = await service.create({ name: 'Work' }, context), imageKey = newId(), documentKey = newId();
    memory.assignments.add(`${tag.key}:document:${documentKey}`);
    const result = await service.setAssignments({ changes: [
      { tagKey: tag.key, target: { type: 'image', key: imageKey }, assigned: true },
      { tagKey: tag.key, target: { type: 'document', key: documentKey }, assigned: false },
      { tagKey: tag.key, target: { type: 'folder', key: newId() }, assigned: false },
    ] }, context, { source: 'ai' });
    expect(result.changes.map(({ target, changed }) => [target.type, changed])).toEqual([['image', true], ['document', true], ['folder', false]]);
    expect(result).toMatchObject({ changedCount: 2, assignedChanged: 1, unassignedChanged: 1 });
    expect(memory.sources).toEqual(['ai']);
  });

  test('applies multiple tags across heterogeneous targets with exact desired-state counts', async () => {
    const memory = memoryRepository(), service = createScopeTagService({ repository: memory.repository, embed: async () => embedding, now: () => timestamp });
    const work = await service.create({ name: 'Work' }, context), priority = await service.create({ name: 'Priority' }, context);
    const folder = { type: 'folder' as const, key: newId() }, image = { type: 'image' as const, key: newId() };
    memory.assignments.add(`${work.key}:folder:${folder.key}`);
    memory.assignments.add(`${priority.key}:image:${image.key}`);
    const result = await service.setAssignments({ changes: [
      { tagKey: work.key, target: folder, assigned: true },
      { tagKey: work.key, target: image, assigned: true },
      { tagKey: priority.key, target: folder, assigned: false },
      { tagKey: priority.key, target: image, assigned: false },
    ] }, context, { source: 'user' });
    expect(result.changes.map(({ changed }) => changed)).toEqual([false, true, false, true]);
    expect(result).toMatchObject({ changedCount: 2, assignedChanged: 1, unassignedChanged: 1 });
    expect(memory.assignments).toEqual(new Set([`${work.key}:folder:${folder.key}`, `${work.key}:image:${image.key}`]));
    expect(memory.sources).toEqual(['user']);
  });

  test('strictly rejects identity, aliases, duplicate tuples, oversized batches, and invalid source options', async () => {
    const memory = memoryRepository(), service = createScopeTagService({ repository: memory.repository, embed: async () => embedding });
    expect(() => scopeTagServiceSchemas.create.parse({ name: 'x', userKey })).toThrow('Unrecognized key');
    expect(() => scopeTagServiceSchemas.create.parse({ key: newId(), name: 'x' })).toThrow('Unrecognized key');
    expect(() => scopeTagServiceSchemas.setAssignments.parse({ changes: [{ tagKey: userKey, target: { type: 'file', key: scopeKey }, assigned: true }] })).toThrow();
    const change = { tagKey: userKey, target: { type: 'document' as const, key: scopeKey }, assigned: true };
    expect(() => scopeTagServiceSchemas.setAssignments.parse({ changes: [change, change] })).toThrow('distinct');
    expect(() => scopeTagServiceSchemas.setAssignments.parse({ changes: Array(101).fill(change) })).toThrow();
    await expect(service.setAssignments({ changes: [change] }, context, { source: 'system' as never })).rejects.toThrow();
  });

  test('lists paginated direct assignment state for every distinct target', async () => {
    const memory = memoryRepository(), service = createScopeTagService({ repository: memory.repository, embed: async () => embedding, now: () => timestamp });
    const first = await service.create({ name: 'First' }, context), second = await service.create({ name: 'Second' }, context);
    const document = { type: 'document' as const, key: newId() }, thread = { type: 'email-thread' as const, key: newId() }, empty = { type: 'book' as const, key: newId() };
    memory.assignments.add(`${first.key}:document:${document.key}`);
    memory.assignments.add(`${second.key}:document:${document.key}`);
    memory.assignments.add(`${second.key}:email-thread:${thread.key}`);
    const result = await service.list({ targets: [document, thread, empty], limit: 10 }, context);
    expect(result).toEqual({
      items: [expect.objectContaining({ key: first.key }), expect.objectContaining({ key: second.key })],
      nextCursor: null,
      targetAssignments: [
        { target: document, tagKeys: [first.key, second.key] },
        { target: thread, tagKeys: [second.key] },
        { target: empty, tagKeys: [] },
      ],
    });
    expect(await service.list({ limit: 10 }, context)).not.toHaveProperty('targetAssignments');
    expect(await service.list({ target: document, limit: 10 }, context)).not.toHaveProperty('targetAssignments');
  });

  test('strictly rejects duplicate, ambiguous, empty, oversized, and unknown batch-list input', () => {
    const target = { type: 'document' as const, key: newId() };
    expect(() => scopeTagServiceSchemas.list.parse({ targets: [target, target] })).toThrow('distinct');
    expect(() => scopeTagServiceSchemas.list.parse({ target, targets: [target] })).toThrow('target or targets');
    expect(() => scopeTagServiceSchemas.list.parse({ targets: [] })).toThrow();
    expect(() => scopeTagServiceSchemas.list.parse({ targets: Array.from({ length: 101 }, () => ({ type: 'document', key: newId() })) })).toThrow();
    expect(() => scopeTagServiceSchemas.list.parse({ targets: [target], assignmentMode: 'direct' })).toThrow('Unrecognized key');
  });

  test('maps an inaccessible batch-list target to a non-disclosing not-found error', async () => {
    const memory = memoryRepository();
    memory.repository.listTargetAssignmentState = async () => { throw new ScopeTagRepositoryError('forbidden', 'private detail'); };
    const service = createScopeTagService({ repository: memory.repository, embed: async () => embedding });
    await expect(service.list({ targets: [{ type: 'book', key: newId() }] }, context)).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Target not found.' });
  });

  test('updates and clears descriptions while recomputing embeddings', async () => {
    const memory = memoryRepository(), texts: string[] = [], service = createScopeTagService({ repository: memory.repository, embed: async ({ text }) => { texts.push(text); return embedding; }, now: () => timestamp });
    const created = await service.create({ name: 'One', description: 'Old' }, context);
    const updated = await service.update({ tagKey: created.key, name: '  TWO  ', description: null }, context);
    expect(updated).toMatchObject({ name: 'TWO' }); expect(updated).not.toHaveProperty('description');
    expect(texts.at(-1)).toBe('two\n\n');
  });

  test('maps inaccessible assignment targets to a non-disclosing domain not-found error', async () => {
    const memory = memoryRepository();
    memory.repository.setAssignments = async () => { throw new ScopeTagRepositoryError('forbidden', 'private detail'); };
    const service = createScopeTagService({ repository: memory.repository, embed: async () => embedding });
    await expect(service.setAssignments({ changes: [{ tagKey: newId(), target: { type: 'book', key: newId() }, assigned: true }] }, context, { source: 'user' })).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Tag or target not found.' });
  });

  test('rejects unauthenticated principals before repository access', async () => {
    const memory = memoryRepository(); let accessed = false;
    memory.repository.list = async () => { accessed = true; return []; };
    const service = createScopeTagService({ repository: memory.repository, embed: async () => embedding });
    const unauthenticated = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'system' } } as ToolContext;
    await expect(service.list({}, unauthenticated)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(accessed).toBe(false);
  });
});
