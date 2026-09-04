import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { SCOPE_TAG_TARGET_ADAPTERS, SCOPE_TAG_TARGETS, createScopeTagRepository, type ScopeTagDatabase } from './repository';

const now = '2026-09-04T12:00:00.000Z';
const owner = { organizationKey: newId(), scopeKey: newId(), userKey: newId(), membershipKey: newId() };
const tag = { key: newId(), scopeKey: owner.scopeKey, userKey: owner.userKey, name: 'Work', normalizedName: 'work', embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: now, updatedAt: now };

describe('scope tag repository', () => {
  test('uses an exhaustive finite target registry without aliases', () => {
    expect(Object.keys(SCOPE_TAG_TARGETS)).toEqual(['folder', 'document', 'image-collection', 'image', 'image-highlight', 'image-memory', 'place', 'trip', 'email-inbox', 'email-tone', 'email-thread', 'email-message', 'email-draft', 'book']);
    expect(SCOPE_TAG_TARGETS).not.toHaveProperty('file'); expect(SCOPE_TAG_TARGETS).not.toHaveProperty('collection'); expect(SCOPE_TAG_TARGETS).not.toHaveProperty('email');
    expect(Object.keys(SCOPE_TAG_TARGET_ADAPTERS)).toEqual(Object.keys(SCOPE_TAG_TARGETS));
    expect(SCOPE_TAG_TARGET_ADAPTERS.document).toEqual({ collection: 'documents', label: 'name' });
  });

  test('queries assignment projections through fixed target branches and canonical access checks', async () => {
    const assignmentKey = newId(), targetKey = newId(); const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const projection = { key: assignmentKey, tag: { key: tag.key, name: tag.name }, target: { type: 'document' as const, key: targetKey, label: 'Research Note' } };
    const database: ScopeTagDatabase = { async query(query, bindVars) { queries.push({ query, bindVars }); return { async next() { return query.includes('COLLECT WITH COUNT') ? 1 : projection; }, async all() { return [projection]; } }; } };
    const repository = createScopeTagRepository(database);
    await expect(repository.listAssignments(owner, { tagKeys: [tag.key], tagMatch: 'all', targetTypes: ['document'], limit: 10 })).resolves.toEqual([projection]);
    await repository.countAssignments(owner, { tagKeys: [tag.key], tagMatch: 'all', targetTypes: ['document'] });
    await expect(repository.getAssignment(owner, assignmentKey)).resolves.toEqual(projection);
    expect(queries[0]?.query).toContain('assignment.sourceType == "document" ? DOCUMENT(documents, assignment.sourceKey)');
    expect(queries[0]?.query).toContain('matchedTags == LENGTH(@tagKeys)');
    expect(queries[0]?.query).toContain('FILTER readable');
    expect(queries[0]?.query).not.toContain('DOCUMENT(@@');
    expect(queries[0]?.bindVars).toMatchObject({ userKey: owner.userKey, tagKeys: [tag.key], targetTypes: ['document'], tagMatch: 'all' });
  });

  test('filters list pagination and target overlays by private owner', async () => {
    let query = '', bindVars: Record<string, unknown> = {};
    const database = { async query(value: string, vars?: Record<string, unknown>) { query = value; bindVars = vars ?? {}; return { async next() {}, async all() { return [{ ...tag, _key: tag.key }]; } }; } };
    const result = await createScopeTagRepository(database).list(owner, { target: { type: 'document', key: newId() }, cursor: { normalizedName: 'a', key: newId() }, limit: 51 });
    expect(query).toContain('tag.userKey == @userKey'); expect(query).toContain('assignment.sourceType == @sourceType'); expect(query).toContain('tag.normalizedName > @cursor.normalizedName');
    expect(query).toContain('scopeRole IN ["owner", "admin", "moderator", "viewer"]');
    expect(query).toContain('privateTarget ? target.userKey == @userKey && (scoped || elevated)');
    expect(query).toContain('collectionTarget ? elevated || collectionMember != null || (managedCollection && scoped)');
    expect(query).toContain('imageTarget ? elevated || imageMemberAccess || (managedImageAccess && scoped)');
    expect(bindVars).toMatchObject({ userKey: owner.userKey, sourceType: 'document', limit: 51 }); expect(result[0]).not.toHaveProperty('_key');
  });

  test('authorizes each batch-list target and returns heterogeneous direct assignment state', async () => {
    const firstTarget = { type: 'document' as const, key: newId() }, secondTarget = { type: 'email-thread' as const, key: newId() }, emptyTarget = { type: 'book' as const, key: newId() };
    const secondTagKey = newId();
    const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database: ScopeTagDatabase = { async query(query, bindVars) { queries.push({ query, bindVars }); return { async next() {}, async all() { return [{ target: firstTarget, tagKeys: [tag.key, secondTagKey] }, { target: secondTarget, tagKeys: [secondTagKey] }, { target: emptyTarget, tagKeys: [] }]; } }; } };
    const result = await createScopeTagRepository(database).listTargetAssignmentState(owner, [firstTarget, secondTarget, emptyTarget], [tag.key, secondTagKey]);
    expect(result).toEqual([
      { target: firstTarget, tagKeys: [tag.key, secondTagKey] },
      { target: secondTarget, tagKeys: [secondTagKey] },
      { target: emptyTarget, tagKeys: [] },
    ]);
    expect(queries).toHaveLength(1);
    for (const { query } of queries) {
      expect(query).toContain('LET readable =');
      expect(query).toContain('FILTER readable');
      expect(query).toContain('assignment.sourceType == requestedTarget.type && assignment.sourceKey == requestedTarget.key');
      expect(query).not.toContain('message.threadKey');
    }
    expect(queries[0]?.bindVars).toMatchObject({ targets: [firstTarget, secondTarget, emptyTarget], tagKeys: [tag.key, secondTagKey] });
  });

  test('fails batch-list assignment state when any target is missing or forbidden', async () => {
    let calls = 0;
    const readable = { type: 'document' as const, key: newId() }, forbidden = { type: 'book' as const, key: newId() };
    const database: ScopeTagDatabase = { async query() { calls += 1; return { async next() {}, async all() { return [{ target: readable, tagKeys: [] }]; } }; } };
    const repository = createScopeTagRepository(database);
    await expect(repository.listTargetAssignmentState(owner, [readable, forbidden], [])).rejects.toMatchObject({ code: 'forbidden' });
    expect(calls).toBe(1);
  });

  test('runs mixed desired-state writes in input order with five bounded transaction queries', async () => {
    const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = []; let transactions = 0;
    const existingKey = newId(), insertedKey = newId(), removedKey = newId();
    const changes = [
      { tagKey: tag.key, target: { type: 'image-collection' as const, key: newId() }, assigned: true },
      { tagKey: tag.key, target: { type: 'email-message' as const, key: newId() }, assigned: false },
      { tagKey: tag.key, target: { type: 'document' as const, key: newId() }, assigned: true },
      { tagKey: tag.key, target: { type: 'book' as const, key: newId() }, assigned: false },
    ];
    const database: ScopeTagDatabase = { async query(query, bindVars) {
      queries.push({ query, bindVars });
      if (query.includes('RETURN requestedTarget')) return { async next() {}, async all() { return bindVars?.targets as unknown[]; } };
      if (query.includes('RETURN tagKey')) return { async next() {}, async all() { return bindVars?.tagKeys as unknown[]; } };
      if (query.includes('LET assignment = FIRST')) return { async next() {}, async all() { return [{ index: 1, assignment: { _key: removedKey, scopeKey: owner.scopeKey, tagKey: tag.key, sourceType: changes[1]!.target.type, sourceKey: changes[1]!.target.key, source: 'ai', createdAt: now } }, { index: 3, assignment: null }]; } };
      if (query.includes('UPSERT')) return { async next() {}, async all() { const writes = bindVars?.changes as Array<{ index: number; assignment: Record<string, unknown> }>; return writes.map(({ index, assignment }, rowIndex) => ({ index, assignment: rowIndex === 0 ? { ...assignment, _key: existingKey, source: 'user' } : assignment, changed: rowIndex !== 0 })); } };
      return { async next() {}, async all() { const remove = (bindVars?.removals as Array<{ index: number }>)[0]!; return [{ index: remove.index, assignment: { _key: removedKey, scopeKey: owner.scopeKey, tagKey: tag.key, sourceType: changes[1]!.target.type, sourceKey: changes[1]!.target.key, source: 'ai', createdAt: now } }]; } };
    } };
    const repository = createScopeTagRepository(database, async (operation) => { transactions += 1; return operation(database); });
    const result = await repository.setAssignments(owner, changes, 'ai', [newId(), newId(), insertedKey, newId()], now);
    expect(transactions).toBe(1); expect(queries).toHaveLength(5);
    expect(result.map(({ assignment, changed }) => [assignment?.key ?? null, assignment?.source ?? null, changed])).toEqual([
      [existingKey, 'user', false], [removedKey, 'ai', true], [insertedKey, 'ai', true], [null, null, false],
    ]);
    expect(queries[0]?.query).toContain('FOR requestedTarget IN @targets'); expect(queries[0]?.query).toContain('managedCollection && scoped');
    expect(queries[1]?.query).toContain('tag.userKey == @userKey'); expect(queries[3]?.query).toContain('UPDATE {}');
    expect(Object.keys(queries[1]?.bindVars ?? {}).sort()).toEqual(['scopeKey', 'tagKeys', 'userKey']);
    expect(queries[2]?.query).toContain('candidate.scopeKey == @scopeKey');
    expect(queries[4]?.query).toContain('REMOVE removal.key');
    for (const { query } of queries) expect(query).not.toContain('DOCUMENT(@@');
  });

  test('keeps assignment query count bounded independently of tuple count', async () => {
    const counts: number[] = [], secondTagKey = newId();
    for (const size of [2, 100]) {
      let calls = 0, authorizedTargets = 0, authorizedTags = 0;
      const database: ScopeTagDatabase = { async query(query, bindVars) {
        calls += 1;
        if (query.includes('RETURN requestedTarget')) return { async next() {}, async all() { authorizedTargets = (bindVars?.targets as unknown[]).length; return bindVars?.targets as unknown[]; } };
        if (query.includes('RETURN tagKey')) return { async next() {}, async all() { authorizedTags = (bindVars?.tagKeys as unknown[]).length; return bindVars?.tagKeys as unknown[]; } };
        if (query.includes('LET assignment = FIRST')) return { async next() {}, async all() { return (bindVars?.changes as Array<{ index: number; tagKey: string; sourceType: string; sourceKey: string }>).map((change) => ({ index: change.index, assignment: { _key: newId(), scopeKey: owner.scopeKey, tagKey: change.tagKey, sourceType: change.sourceType, sourceKey: change.sourceKey, source: 'user', createdAt: now } })); } };
        if (query.includes('UPSERT')) return { async next() {}, async all() { return (bindVars?.changes as Array<{ index: number; assignment: unknown }>).map((change) => ({ ...change, changed: true })); } };
        return { async next() {}, async all() { return (bindVars?.removals as Array<{ index: number; key: string }>).map((removal) => ({ index: removal.index, assignment: { _key: removal.key, scopeKey: owner.scopeKey, tagKey: changes[removal.index]!.tagKey, sourceType: changes[removal.index]!.target.type, sourceKey: changes[removal.index]!.target.key, source: 'user', createdAt: now } })); } };
      } };
      const targetKeys = Array.from({ length: size / 2 }, () => newId());
      const changes = Array.from({ length: size }, (_, index) => ({ tagKey: index % 2 === 0 ? tag.key : secondTagKey, target: { type: 'document' as const, key: targetKeys[Math.floor(index / 2)]! }, assigned: index % 2 === 0 }));
      const result = await createScopeTagRepository(database, (operation) => operation(database)).setAssignments(owner, changes, 'user', changes.map(() => newId()), now);
      expect(result).toHaveLength(size); expect(result.filter(({ changed }) => changed)).toHaveLength(size);
      expect(authorizedTargets).toBe(size / 2); expect(authorizedTags).toBe(2);
      counts.push(calls);
    }
    expect(counts).toEqual([5, 5]);
  });

  test('aborts unauthorized target and tag batches before any assignment write', async () => {
    const target = { type: 'document' as const, key: newId() }, change = { tagKey: tag.key, target, assigned: true };
    for (const denied of ['target', 'tag'] as const) {
      const queries: string[] = [];
      const database: ScopeTagDatabase = { async query(query, bindVars) { queries.push(query); return { async next() {}, async all() {
        if (query.includes('RETURN requestedTarget')) return denied === 'target' ? [] : bindVars?.targets as unknown[];
        if (query.includes('RETURN tagKey')) return [];
        throw new Error('write query must not run');
      } }; } };
      await expect(createScopeTagRepository(database, (operation) => operation(database)).setAssignments(owner, [change], 'user', [newId()], now)).rejects.toMatchObject({ code: 'forbidden' });
      expect(queries).toHaveLength(denied === 'target' ? 1 : 2); expect(queries.some((query) => query.includes('UPSERT') || query.includes('REMOVE assignment'))).toBe(false);
    }
  });

  test('hard-deletes assignments before an owned tag in one transaction', async () => {
    let query = '', transactions = 0;
    const database: ScopeTagDatabase = { async query(value) { query = value; return { async next() { return true; }, async all() { return []; } }; } };
    const deleted = await createScopeTagRepository(database, async (operation) => { transactions += 1; return operation(database); }).delete(owner, tag.key);
    expect(deleted).toBe(true); expect(transactions).toBe(1); expect(query.indexOf('REMOVE assignment')).toBeLessThan(query.indexOf('REMOVE tag'));
    expect(query).toContain('tag.userKey == @userKey'); expect(query).toContain('membership.userId == @userKey');
  });

  test('resolves distinct any/all candidate keys and stable private tag projections', async () => {
    const targetKey = newId(); const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database: ScopeTagDatabase = { async query(query, bindVars) { queries.push({ query, bindVars }); return { async next() {}, async all() { return query.includes('COUNT_DISTINCT') ? [{ sourceType: 'document', sourceKey: targetKey }] : query.includes('COLLECT threadKey') ? [targetKey] : [{ identity: `document\0${targetKey}`, tags: [{ key: tag.key, name: tag.name }] }]; } }; } };
    const repository = createScopeTagRepository(database);
    const secondTagKey = newId();
    await expect(repository.resolveCandidateKeys(owner, [tag.key, secondTagKey], ['document', 'email-thread'], 'any')).resolves.toEqual({ document: [targetKey], 'email-thread': [] });
    await expect(repository.resolveCandidateKeys(owner, [tag.key, secondTagKey], ['document', 'email-thread'], 'all')).resolves.toEqual({ document: [targetKey], 'email-thread': [] });
    await expect(repository.resolveEmailThreadKeys(owner, [newId()])).resolves.toEqual([targetKey]);
    await expect(repository.listTargetTags(owner, [{ type: 'document', key: targetKey }])).resolves.toEqual({ [`document\0${targetKey}`]: [{ key: tag.key, name: 'Work' }] });
    expect(queries[0]?.query).toContain('matchedTags == LENGTH(ownedTags)');
    expect(queries[0]?.bindVars).toMatchObject({ userKey: owner.userKey, scopeKey: owner.scopeKey, match: 'any', targetTypes: ['document', 'email-thread'] });
    expect(queries[1]?.bindVars).toMatchObject({ userKey: owner.userKey, scopeKey: owner.scopeKey, match: 'all', targetTypes: ['document', 'email-thread'] });
    expect(queries[2]?.query).toContain('message.threadKey');
    expect(queries[3]?.query).toContain('tag.userKey == @userKey');
    expect(queries[3]?.query).toContain('assignment.sourceType == "email-message"');
    expect(queries[3]?.query).toContain('SORT tag.normalizedName ASC, tag._key ASC');
  });

  test('ranks the complete fixed-collection candidate set before app-search limits', async () => {
    const targetKey = newId(); let query = '', bindVars: Record<string, unknown> = {};
    const database: ScopeTagDatabase = { async query(value, variables) { query = value; bindVars = variables ?? {}; return { async next() {}, async all() { return [{ key: targetKey, score: 0.42 }]; } }; } };
    const result = await createScopeTagRepository(database).rankCandidateKeys(owner, 'book', [targetKey], Array(EMBEDDING_DIMENSIONS).fill(1));
    expect(result).toEqual([{ key: targetKey, score: 0.42 }]);
    expect(query).toContain('@targetType == "book" ? DOCUMENT(books, sourceKey)');
    expect(query.indexOf('SORT score DESC')).toBeGreaterThan(query.indexOf('COSINE_SIMILARITY'));
    expect(query).not.toContain('SORT score DESC, sourceKey ASC LIMIT');
    expect(bindVars).toMatchObject({ targetType: 'book', candidateKeys: [targetKey], scopeKey: owner.scopeKey, userKey: owner.userKey });
  });

  test('resolves and semantically ranks only tags owned by the active user and scope', async () => {
    const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database: ScopeTagDatabase = { async query(query, bindVars) { queries.push({ query, bindVars }); return { async next() {}, async all() { return query.includes('COSINE_SIMILARITY') ? [{ ...tag, _key: tag.key, score: 0.8 }] : [{ ...tag, _key: tag.key }]; } }; } };
    const repository = createScopeTagRepository(database);
    await expect(repository.resolveOwnedByNormalizedNames(owner, ['work'])).resolves.toEqual([tag]);
    await expect(repository.searchOwned(owner, Array(EMBEDDING_DIMENSIONS).fill(1), 10)).resolves.toEqual([{ ...tag, score: 0.8 }]);
    for (const { query } of queries) {
      expect(query).toContain('tag.scopeKey == @scopeKey');
      expect(query).toContain('tag.userKey == @userKey');
    }
    expect(queries[0]?.bindVars).toMatchObject({ normalizedNames: ['work'] });
    expect(queries[1]?.query).toContain('SORT score DESC, tag.normalizedName ASC');
  });

  test('authorizes every private tag operation for active scope viewers only', async () => {
    const queries: string[] = [];
    const database: ScopeTagDatabase = { async query(query, bindVars) { queries.push(query); return { async next() {}, async all() { if (query.includes('RETURN { target: requestedTarget')) return [{ target: (bindVars?.targets as unknown[])[0], tagKeys: [] }]; if (query.includes('RETURN requestedTarget')) return bindVars?.targets as unknown[]; if (query.includes('RETURN tagKey')) return bindVars?.tagKeys as unknown[]; return []; } }; } };
    const repository = createScopeTagRepository(database, (operation) => operation(database));
    await repository.list(owner, { limit: 10 });
    await repository.list(owner, { target: { type: 'place', key: newId() }, limit: 10 });
    await repository.get(owner, tag.key);
    await repository.resolveOwnedByNormalizedNames(owner, ['work']);
    await repository.searchOwned(owner, tag.embedding, 10);
    await repository.create(owner, tag);
    await repository.update(owner, tag.key, { name: tag.name, normalizedName: tag.normalizedName, description: null, embedding: tag.embedding, updatedAt: now });
    await repository.delete(owner, tag.key);
    await repository.setAssignments(owner, [{ tagKey: tag.key, target: { type: 'trip', key: newId() }, assigned: false }], 'user', [newId()], now);
    await repository.resolveCandidateKeys(owner, [tag.key], ['document'], 'any');
    await repository.resolveEmailThreadKeys(owner, [newId()]);
    await repository.rankCandidateKeys(owner, 'document', [newId()], tag.embedding);
    await repository.listTargetTags(owner, [{ type: 'document', key: newId() }]);
    await repository.listTargetAssignmentState(owner, [{ type: 'document', key: newId() }], [tag.key]);

    const authorizationQueries = queries.filter((query) => query.includes('DOCUMENT(userOrganizations, @membershipKey)'));
    expect(authorizationQueries).toHaveLength(14);
    for (const query of authorizationQueries) {
      expect(query).toContain('membership != null');
      expect(query).toContain('membership.status == "active"');
      expect(query).toContain('"viewer"');
      expect(query).not.toContain('"moderator", "member"');
    }
  });
});
