import { describe, expect, test } from 'bun:test';
import { STORAGE_RETENTION_SCAN_BATCH_SIZE, STORAGE_WIPE_BATCH_SIZE, STORAGE_WIPE_COLLECTIONS, createStorageRetentionRepository, storageRetentionStateSchema } from './storage-retention-repository';

describe('storage retention repository', () => {
  test('models an explicit durable lifecycle and declares the complete wipe transaction', () => {
    expect(storageRetentionStateSchema.parse({ key: 'state', userKey: 'user', paymentPastDueAt: '2026-01-01T00:00:00.000Z', wipeDueAt: '2026-04-01T00:00:00.000Z', minimumBalanceMicroSparks: 10 })).toMatchObject({ userKey: 'user' });
    for (const collection of ['storageRetentionStates', 'storageObjects', 'storageDeletionJobs', 'users', 'documents', 'images', 'galleryUploads']) expect(STORAGE_WIPE_COLLECTIONS).toContain(collection as never);
  });

  test('fences stale wipe jobs before touching storage references', async () => {
    const queries: string[] = [];
    const transaction = { async query(query: string) { queries.push(query); return { async next() { return undefined; }, async all() { return []; } }; } };
    const repository = createStorageRetentionRepository(transaction, async (operation) => operation(transaction));
    await expect(repository.wipe({ userKey: 'user', expectedWipeDueAt: '2026-04-01T00:00:00.000Z', batch: 0, now: '2026-04-02T00:00:00.000Z' })).resolves.toEqual({ status: 'stale' });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('state.wipeDueAt == @expectedWipeDueAt');
    expect(queries[0]).toContain('currentBatch == @batch');
    expect(queries[0]).toContain('@batch > 0 && state.wipeStartedAt != null');
    expect(queries[0]).toContain('user == null ||');
    expect(queries[0]).toContain('user.microSparkBalance < state.minimumBalanceMicroSparks');
  });

  test('keyset-paginates unfunded users with a bounded scan size', async () => {
    let query = '', bind: Record<string, unknown> | undefined;
    const database = { async query(value: string, values?: Record<string, unknown>) { query = value; bind = values; return { async next() { return undefined; }, async all() { return []; } }; } };
    const repository = createStorageRetentionRepository(database, async (operation) => operation(database));
    await repository.listUnfunded({ afterKey: 'state-100', limit: STORAGE_RETENTION_SCAN_BATCH_SIZE + 1 });
    expect(query).toContain('state._key > @afterKey SORT state._key ASC LIMIT @limit');
    expect(bind).toMatchObject({ afterKey: 'state-100', limit: STORAGE_RETENTION_SCAN_BATCH_SIZE });
  });

  test('detaches the complete owned reference set and completes the fenced wipe', async () => {
    const queries: string[] = [];
    const transaction = { async query(query: string) {
      queries.push(query);
      return {
        async next() { return query.includes('LET state = FIRST') || query.includes('UPDATE state WITH') ? true : undefined; },
        async all() {
          if (query.includes('LIMIT @batchSize RETURN storageKey')) return ['owned/key'];
          return [];
        },
      };
    } };
    const repository = createStorageRetentionRepository(transaction, async (operation) => operation(transaction));
    await expect(repository.wipe({ userKey: 'user', expectedWipeDueAt: '2026-04-01T00:00:00.000Z', batch: 0, now: '2026-04-02T00:00:00.000Z' })).resolves.toEqual({ status: 'wiped', processed: 1 });
    const source = queries.join('\n');
    for (const reference of ['profileStorageKey', 'coverStorageKey', 'audioStorageKey', 'emailAttachments', 'placeHeroMedia', 'sourceStorageKeys', 'speechStorageKeys', 'documentVersions', 'documentAudioVersions', 'documentSummaryAudio', 'galleryUploads']) expect(source).toContain(reference);
    for (const graph of ['collectionImages', 'placeImages', 'imageIdentities', 'visualIdentities', 'imageCollecitionHightlights', 'imageCollectionMemories', 'imageCaptions']) expect(source).toContain(graph);
    for (const dependent of ['tagAssignments', 'shares', 'userHiddens', 'conversationMessages', 'emailMessages', 'emailDrafts']) expect(source).toContain(dependent);
    expect(source).toContain('REMOVE_VALUES(document.sourceStorageKeys, @storageKeys)');
    expect(source).toContain('UPSERT { storageKey }');
    expect(source).toContain('object.userKey == @userKey && object.deletedAt == null');
    expect(source).toContain('state.wipeDueAt == @expectedWipeDueAt');
    expect(source).toContain('state.wipedAt == null');
  });

  test.each([0, 1, 999, 1000, 1001])('selects an exact bounded batch from %i active keys', async (count) => {
    const keys = Array.from({ length: Math.min(count, STORAGE_WIPE_BATCH_SIZE) }, (_, index) => `owned/${String(index).padStart(4, '0')}`);
    const selections: Array<Record<string, unknown> | undefined> = [];
    const transaction = { async query(query: string, bind?: Record<string, unknown>) {
      if (query.includes('LIMIT @batchSize RETURN storageKey')) selections.push(bind);
      return {
        async next() {
          if (query.includes('LET state = FIRST')) return true;
          if (query.includes('LIMIT 1 RETURN true')) return count > STORAGE_WIPE_BATCH_SIZE ? true : undefined;
          if (query.includes('UPDATE state WITH')) return true;
          return undefined;
        },
        async all() { return query.includes('LIMIT @batchSize RETURN storageKey') ? keys : []; },
      };
    } };
    const repository = createStorageRetentionRepository(transaction, async (operation) => operation(transaction));
    const result = await repository.wipe({ userKey: 'user', expectedWipeDueAt: '2026-04-01T00:00:00.000Z', batch: 0, now: '2026-04-02T00:00:00.000Z' });
    expect(selections).toEqual([{ '@objects': 'storageObjects', userKey: 'user', batchSize: 1000 }]);
    expect(result).toEqual(count > 1000 ? { status: 'continued', nextBatch: 1, processed: 1000 } : { status: 'wiped', processed: count });
  });

  test('funding is fenced out after destructive work starts', async () => {
    let query = '';
    const database = { async query(value: string) { query = value; return { async next() { return false; }, async all() { return []; } }; } };
    const repository = createStorageRetentionRepository(database, async (operation) => operation(database));
    await expect(repository.markFunded('user', '2026-04-02T00:00:00.000Z')).resolves.toBe(false);
    expect(query).toContain('state.wipeStartedAt == null');
  });
});
