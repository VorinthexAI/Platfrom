import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createGalleryRepository } from './repository';

describe('Gallery repository collection access', () => {
  test('authorizes user collections by owner key while preserving manager and system-viewer access', async () => {
    let query = '';
    const database = {
      async query(value: string) {
        query = value;
        return { async all() { return []; } };
      },
    };

    const repository = createGalleryRepository(database as never);
    await expect(repository.getCollectionRole(newId(), newId(), newId())).resolves.toBeNull();

    expect(query).toContain('membership.status == "active"');
    expect(query).toContain('membership.teamKey == scope.teamKey');
    expect(query).toContain('membership.teamRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"]');
    expect(query).toContain('collection.mutationPolicy == "system-only" && scoped');
    expect(query).toContain('collection.ownerKey == @actorKey');
    expect(query).not.toContain('collectionMembers');
    expect(query).not.toContain('collaborator');
  });
});
