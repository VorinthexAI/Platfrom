import { describe, expect, test } from 'bun:test';
import { contentToolInputSchemas, contentToolJsonSchemas, type ContentActionSlug } from './domain-content-schemas';
import { executeContentLifecycleTool } from './domain-execute-content';

const scopeKey = 'cmrnlzf640000qc7k4p5zem5w';
const folderKey = 'cmrnlzf640001qc7k4p5zem5w';
const documentKey = 'cmrnlzf640002qc7k4p5zem5w';
const versionKey = 'cmrnlzf640003qc7k4p5zem5w';
const shareKey = 'cmrnlzf640004qc7k4p5zem5w';
const timestamp = '2026-07-22T00:00:00.000Z';

function harness() {
  const folder = { key: folderKey, scopeKey, name: 'Folder', embedding: [], deletedAt: null as string | null, createdAt: timestamp, updatedAt: timestamp };
  const document = { key: documentKey, scopeKey, folderKey, name: 'Doc', extension: 'txt' as const, mimeType: 'text/plain', storageKey: 'x', sizeBytes: 1, content: 'x', embedding: [1], deletedAt: null as string | null, createdAt: timestamp, updatedAt: timestamp };
  const version = { key: versionKey, scopeKey, documentKey, version: 1, content: 'x', embedding: [1], deletedAt: null as string | null, createdAt: timestamp };
  const share = { key: shareKey, scopeKey, documentKey, permission: 'read' as const, tokenHash: 'a'.repeat(64), deletedAt: null as string | null, createdAt: timestamp, updatedAt: timestamp };
  const mutate = <T extends { deletedAt: string | null }>(node: T, deletedAt: string | null) => async () => Object.assign(node, { deletedAt });
  const dependencies = {
    authorize: async () => undefined,
    getFolder: async (key: string) => key === folderKey ? folder : null,
    getDocument: async (key: string) => key === documentKey ? document : null,
    getDocumentVersion: async (key: string) => key === versionKey ? version : null,
    getDocumentShare: async (key: string) => key === shareKey ? share : null,
    contentFolder: mutate(folder, timestamp), restoreFolder: mutate(folder, null),
    contentDocument: mutate(document, timestamp), restoreDocument: mutate(document, null),
    contentDocumentVersion: mutate(version, timestamp), restoreDocumentVersion: mutate(version, null),
    contentDocumentShare: mutate(share, timestamp), restoreDocumentShare: mutate(share, null),
    isProjectFolder: async () => false,
    atomicMutate: async (resource: string, _keys: string[], deletedAt: string | null) => {
      const node = resource === 'folders' ? folder : resource === 'documents' ? document : resource === 'documentVersions' ? version : share;
      Object.assign(node, { deletedAt, updatedAt: timestamp });
      return [node];
    },
  };
  return { folder, document, version, share, dependencies };
}

const cases = [
  ['folder', 'folderKey', folderKey],
  ['document', 'documentKey', documentKey],
  ['document-version', 'documentVersionKey', versionKey],
  ['document-share', 'documentShareKey', shareKey],
] as const;

describe('Content lifecycle domain tools', () => {
  test('registers strict batch schemas for every Content resource', () => {
    expect(Object.keys(contentToolInputSchemas)).toHaveLength(8);
    for (const [action, schema] of Object.entries(contentToolInputSchemas)) {
      expect(action in contentToolJsonSchemas).toBe(true);
      expect(() => schema.parse({ items: [], unknown: true })).toThrow();
    }
  });

  test('archive sets deletedAt and restore clears it for every resource', async () => {
    for (const [resource, field, key] of cases) {
      const context = harness();
      const contentAction = `${resource}.archive` as ContentActionSlug;
      const restoreAction = `${resource}.restore` as ContentActionSlug;
      const archived = await executeContentLifecycleTool(contentAction, { items: [{ [field]: key }], atomic: true }, { organizationKey: 'org' }, context.dependencies as never);
      expect(archived.items[0]).toMatchObject({ key, success: true });
      expect((archived.items[0] as { value: { deletedAt: string } }).value.deletedAt).toBeString();
      const restored = await executeContentLifecycleTool(restoreAction, { items: [{ [field]: key }], atomic: true }, { organizationKey: 'org' }, context.dependencies as never);
      expect(restored.items[0]).toMatchObject({ key, success: true, value: { deletedAt: null } });
    }
  });

  test('supports partial failures and atomic prevalidation without mutating valid items', async () => {
    const partialContext = harness();
    const partial = await executeContentLifecycleTool('folder.archive', { items: [{ folderKey }, { folderKey: shareKey }], atomic: false }, { organizationKey: 'org' }, partialContext.dependencies as never);
    expect(partial.items.map(({ success }) => success)).toEqual([true, false]);

    const atomicContext = harness();
    const atomic = await executeContentLifecycleTool('folder.archive', { items: [{ folderKey }, { folderKey: shareKey }], atomic: true }, { organizationKey: 'org' }, atomicContext.dependencies as never);
    expect(atomic.items.every(({ success }) => !success)).toBe(true);
    expect(atomicContext.folder.deletedAt).toBeNull();
  });

  test('enforces authorization and active parent restoration', async () => {
    const denied = harness();
    denied.dependencies.authorize = async () => { throw new Error('forbidden'); };
    const deniedResult = await executeContentLifecycleTool('document.archive', { items: [{ documentKey }], atomic: false }, { organizationKey: 'org' }, denied.dependencies as never);
    expect(deniedResult.items[0]).toMatchObject({ success: false, error: 'forbidden' });

    const parent = harness();
    parent.document.deletedAt = timestamp;
    parent.folder.deletedAt = timestamp;
    const restore = await executeContentLifecycleTool('document.restore', { items: [{ documentKey }], atomic: false }, { organizationKey: 'org' }, parent.dependencies as never);
    expect(restore.items[0]).toMatchObject({ success: false });
    expect(parent.document.deletedAt).toBe(timestamp);
  });

  test('protects canonical project folders and delegates atomic writes as one operation', async () => {
    const projectFolder = harness();
    projectFolder.dependencies.isProjectFolder = async () => true;
    const blocked = await executeContentLifecycleTool('folder.archive', { items: [{ folderKey }], atomic: false }, { organizationKey: 'org' }, projectFolder.dependencies as never);
    expect(blocked.items[0]).toMatchObject({ success: false });
    expect(projectFolder.folder.deletedAt).toBeNull();

    const atomic = harness();
    let calls = 0;
    atomic.dependencies.atomicMutate = async () => { calls += 1; throw new Error('transaction rolled back'); };
    const failed = await executeContentLifecycleTool('document.archive', { items: [{ documentKey }, { documentKey }], atomic: true }, { organizationKey: 'org' }, atomic.dependencies as never);
    expect(calls).toBe(1);
    expect(failed.items.every(({ success }) => !success)).toBe(true);
    expect(atomic.document.deletedAt).toBeNull();
  });

  test('routes document-share lifecycle batches through marker-aware Content persistence', async () => {
    const source = await Bun.file(new URL('./domain-execute-content.ts', import.meta.url)).text();
    expect(source).toContain("if (resource === 'documentShares')");
    expect(source).toContain('withContentPersistenceTransaction');
    expect(source).toContain('persistence.updateShare');
  });
});
