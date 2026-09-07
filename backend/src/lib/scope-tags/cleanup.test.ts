import { describe, expect, test } from 'bun:test';
import { SCOPE_KEYED_REMOVAL_COLLECTIONS } from '@/lib/ai/scopes/repository';

const read = (relative: string) => Bun.file(new URL(relative, import.meta.url)).text();

describe('scope tag lifecycle cleanup', () => {
  test('scope and user deletion remove owned tags and assignments', async () => {
    const [scopes, users] = await Promise.all([read('../ai/scopes/repository.ts'), read('../db/users.node.ts')]);
    expect(SCOPE_KEYED_REMOVAL_COLLECTIONS).toContain('tags');
    expect(SCOPE_KEYED_REMOVAL_COLLECTIONS).toContain('tagAssignments');
    expect(scopes).toContain("'tags', 'tagAssignments'");
    expect(users).toContain('FOR tag IN tags FILTER tag.userKey == @userKey');
    expect(users.indexOf('REMOVE assignment IN tagAssignments')).toBeLessThan(users.indexOf('REMOVE tag IN tags'));
  });

  test('canonical target deletions clean every assignment type', async () => {
    const [content, gallery, travel, email, connectors, books] = await Promise.all([
      read('../db/content-persistence.node.ts'), read('../gallery/repository.ts'), read('../travel/repository.ts'), read('../email-inbox/canonical-repository.ts'), read('../email-inbox/connector-repository.ts'), read('../books/repository.ts'),
    ]);
    for (const type of ['folder', 'document']) expect(content).toContain(`"${type}"`);
    for (const type of ['image-collection', 'image', 'image-highlight', 'image-memory']) expect(gallery).toContain(`assignment.sourceType == "${type}"`);
    for (const type of ['place', 'trip']) expect(travel).toContain(`assignment.sourceType == "${type}"`);
    for (const type of ['email-tone', 'email-thread', 'email-message', 'email-draft']) expect(email).toContain(`assignment.sourceType == "${type}"`);
    expect(connectors).toContain('assignment.sourceType == "email-inbox"');
    expect(books).toContain('assignment.sourceType == "book"');
  });
});
