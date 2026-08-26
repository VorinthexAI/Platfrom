import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createBookRepository } from './repository';

describe('book Archive publication', () => {
  test('publishes deterministic protected chapter bindings under the generation fence', async () => {
    const queries: string[] = [];
    const database: any = { query: async (query: string) => { queries.push(query); return { all: async () => query.includes('userOrganizations') ? [1] : query.includes('generated-audio-root') ? [10] : [] }; } };
    const repository = createBookRepository(database, async (_collections, operation) => operation(database));
    await repository.publishChapters({ organizationKey: 'org', scopeKey: newId(), userKey: newId(), generationLeaseToken: 'owner' }, newId(), 10, new Date().toISOString());
    const publication = queries.find((query) => query.includes('generated-audio-root'))!;
    expect(publication).toContain('managedPurpose: "audio-book"'); expect(publication).toContain('generated-audio-chapter'); expect(publication).toContain('subjectType: "chapter"'); expect(publication).toContain('managedPurpose: "audio-chapter"'); expect(publication).toContain('chapter.audioDurationSeconds == null'); expect(publication).toContain('generationLeaseToken == @generationLeaseToken');
  });

  test('rejects publication when any atomic prerequisite is missing', async () => {
    const database: any = { query: async (query: string) => ({ all: async () => query.includes('userOrganizations') ? [1] : [] }) };
    const repository = createBookRepository(database, async (_collections, operation) => operation(database));
    await expect(repository.publishChapters({ organizationKey: 'org', scopeKey: newId(), userKey: newId(), generationLeaseToken: 'owner' }, newId(), 10, new Date().toISOString())).rejects.toMatchObject({ reason: 'conflict' });
  });
});
