import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { createBookRepository, type BookDatabase } from './repository';

describe('book Gallery export persistence', () => {
  test('recreates an ordinary collection and links independent images without overwriting it', async () => {
    const scopeKey = newId(); const userKey = newId(); const ownerKey = newId(); const imageKey = newId(); const calls: Array<{ query: string; bind: Record<string, unknown> }> = [];
    const database: BookDatabase = { async query(query, bind = {}) {
      calls.push({ query, bind });
      if (query.includes('RETURN membership._key') || query.includes('FOR membership IN userOrganizations')) return { all: async () => [ownerKey] };
      if (query.includes('RETURN imageKey')) return { all: async () => [imageKey] };
      return { all: async () => [] };
    } };
    const context = { organizationKey: 'organization', scopeKey, userKey };
    const repository = createBookRepository(database, async (_collections, operation) => operation(database));
    const ensured = await repository.ensureGalleryExportCollection(context, newId(), 'A Better Book', Array(EMBEDDING_DIMENSIONS).fill(0), '2026-08-27T12:00:00.000Z');
    await repository.linkGalleryExportImages(context, ensured.collectionKey, ensured.ownerKey, [imageKey], '2026-08-27T12:00:00.000Z');
    const collection = calls.find(({ query }) => query.includes('IN collections'))!.query;
    const membership = calls.find(({ query }) => query.includes('IN collectionMembers'))!.query;
    const relation = calls.find(({ query }) => query.includes('IN collectionImages') && query.includes('RETURN imageKey'))!.query;
    expect(collection).toContain('mutationPolicy: "user"'); expect(collection).toContain('@bookTitle'); expect(collection).not.toContain('purpose'); expect(collection).not.toContain('system-only');
    expect(membership).toContain('role: "owner"'); expect(membership).toContain('UPDATE { role: "owner"');
    expect(relation).toContain('collection.mutationPolicy == "user"'); expect(relation).toContain('collection.purpose == null'); expect(relation).toContain('UPDATE {}');
    expect(relation).toContain('image.createdByKey == @ownerKey');
    expect(calls.some(({ query }) => query.includes('relation.imageKey NOT IN @imageKeys'))).toBe(true);
  });
});
