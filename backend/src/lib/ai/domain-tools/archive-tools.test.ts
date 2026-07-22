import { describe, expect, test } from 'bun:test';
import { archiveToolInputSchemas, archiveToolJsonSchemas, type ArchiveActionSlug } from './archive-schemas';
import { executeArchiveLifecycleTool } from './execute-archive';

const scopeKey = 'cmrnlzf640000qc7k4p5zem5w';
const folderKey = 'cmrnlzf640001qc7k4p5zem5w';
const documentKey = 'cmrnlzf640002qc7k4p5zem5w';
const versionKey = 'cmrnlzf640003qc7k4p5zem5w';
const shareKey = 'cmrnlzf640004qc7k4p5zem5w';
const timestamp = '2026-07-22T00:00:00.000Z';

function harness() {
  const folder = { key: folderKey, scopeKey, name: 'Folder', embedding: [], deletedAt: null as string | null, createdAt: timestamp, updatedAt: timestamp };
  const document = { key: documentKey, scopeKey, folderKey, name: 'Doc', extension: 'txt' as const, mimeType: 'text/plain', html: '<p>x</p>', storageKey: 'x', sizeBytes: 1, json: { type: 'doc' as const }, content: 'x', embedding: [1], deletedAt: null as string | null, createdAt: timestamp, updatedAt: timestamp };
  const version = { key: versionKey, scopeKey, documentKey, version: 1, storageKey: 'v', sizeBytes: 1, content: 'x', embedding: [1], deletedAt: null as string | null, createdAt: timestamp, updatedAt: timestamp };
  const share = { key: shareKey, scopeKey, documentKey, token: 'token', embedding: [], deletedAt: null as string | null, createdAt: timestamp, updatedAt: timestamp };
  const events: string[] = [];
  const mutate = <T extends { deletedAt: string | null; updatedAt: string }>(node: T, deletedAt: string | null) => async () => Object.assign(node, { deletedAt, updatedAt: timestamp });
  const dependencies = {
    authorize: async () => undefined,
    emit: async (action: ArchiveActionSlug) => { events.push(action); },
    getFolder: async (key: string) => key === folderKey ? folder : null,
    getDocument: async (key: string) => key === documentKey ? document : null,
    getDocumentVersion: async (key: string) => key === versionKey ? version : null,
    getDocumentShare: async (key: string) => key === shareKey ? share : null,
    archiveFolder: mutate(folder, timestamp), restoreFolder: mutate(folder, null),
    archiveDocument: mutate(document, timestamp), restoreDocument: mutate(document, null),
    archiveDocumentVersion: mutate(version, timestamp), restoreDocumentVersion: mutate(version, null),
    archiveDocumentShare: mutate(share, timestamp), restoreDocumentShare: mutate(share, null),
    isProjectFolder: async () => false,
    atomicMutate: async (resource: string, _keys: string[], deletedAt: string | null) => {
      const node = resource === 'folders' ? folder : resource === 'documents' ? document : resource === 'documentVersions' ? version : share;
      Object.assign(node, { deletedAt, updatedAt: timestamp });
      return [node];
    },
  };
  return { folder, document, version, share, events, dependencies };
}

const cases = [
  ['folder', 'folderKey', folderKey],
  ['document', 'documentKey', documentKey],
  ['document-version', 'documentVersionKey', versionKey],
  ['document-share', 'documentShareKey', shareKey],
] as const;

describe('Archive lifecycle domain tools', () => {
  test('registers strict batch schemas for every Archive resource', () => {
    expect(Object.keys(archiveToolInputSchemas)).toHaveLength(8);
    for (const [action, schema] of Object.entries(archiveToolInputSchemas)) {
      expect(action in archiveToolJsonSchemas).toBe(true);
      expect(() => schema.parse({ items: [], unknown: true })).toThrow();
    }
  });

  test('archive sets deletedAt and restore clears it for every resource', async () => {
    for (const [resource, field, key] of cases) {
      const context = harness();
      const archiveAction = `${resource}.archive` as ArchiveActionSlug;
      const restoreAction = `${resource}.restore` as ArchiveActionSlug;
      const archived = await executeArchiveLifecycleTool(archiveAction, { items: [{ [field]: key }], atomic: true }, { organizationKey: 'org', runtimeScopeKey: scopeKey }, context.dependencies as never);
      expect(archived.items[0]).toMatchObject({ key, success: true });
      expect((archived.items[0] as { value: { deletedAt: string } }).value.deletedAt).toBeString();
      const restored = await executeArchiveLifecycleTool(restoreAction, { items: [{ [field]: key }], atomic: true }, { organizationKey: 'org', runtimeScopeKey: scopeKey }, context.dependencies as never);
      expect(restored.items[0]).toMatchObject({ key, success: true, value: { deletedAt: null } });
      expect(context.events).toEqual([archiveAction, restoreAction]);
    }
  });

  test('supports partial failures and atomic prevalidation without mutating valid items', async () => {
    const partialContext = harness();
    const partial = await executeArchiveLifecycleTool('folder.archive', { items: [{ folderKey }, { folderKey: shareKey }], atomic: false }, { organizationKey: 'org', runtimeScopeKey: scopeKey }, partialContext.dependencies as never);
    expect(partial.items.map(({ success }) => success)).toEqual([true, false]);

    const atomicContext = harness();
    const atomic = await executeArchiveLifecycleTool('folder.archive', { items: [{ folderKey }, { folderKey: shareKey }], atomic: true }, { organizationKey: 'org', runtimeScopeKey: scopeKey }, atomicContext.dependencies as never);
    expect(atomic.items.every(({ success }) => !success)).toBe(true);
    expect(atomicContext.folder.deletedAt).toBeNull();
  });

  test('enforces authorization and active parent restoration', async () => {
    const denied = harness();
    denied.dependencies.authorize = async () => { throw new Error('forbidden'); };
    const deniedResult = await executeArchiveLifecycleTool('document.archive', { items: [{ documentKey }], atomic: false }, { organizationKey: 'org', runtimeScopeKey: scopeKey }, denied.dependencies as never);
    expect(deniedResult.items[0]).toMatchObject({ success: false, error: 'forbidden' });

    const parent = harness();
    parent.document.deletedAt = timestamp;
    parent.folder.deletedAt = timestamp;
    const restore = await executeArchiveLifecycleTool('document.restore', { items: [{ documentKey }], atomic: false }, { organizationKey: 'org', runtimeScopeKey: scopeKey }, parent.dependencies as never);
    expect(restore.items[0]).toMatchObject({ success: false });
    expect(parent.document.deletedAt).toBe(timestamp);
  });

  test('protects canonical project folders and delegates atomic writes as one operation', async () => {
    const projectFolder = harness();
    projectFolder.dependencies.isProjectFolder = async () => true;
    const blocked = await executeArchiveLifecycleTool('folder.archive', { items: [{ folderKey }], atomic: false }, { organizationKey: 'org', runtimeScopeKey: scopeKey }, projectFolder.dependencies as never);
    expect(blocked.items[0]).toMatchObject({ success: false });
    expect(projectFolder.folder.deletedAt).toBeNull();

    const atomic = harness();
    let calls = 0;
    atomic.dependencies.atomicMutate = async () => { calls += 1; throw new Error('transaction rolled back'); };
    const failed = await executeArchiveLifecycleTool('document.archive', { items: [{ documentKey }, { documentKey }], atomic: true }, { organizationKey: 'org', runtimeScopeKey: scopeKey }, atomic.dependencies as never);
    expect(calls).toBe(1);
    expect(failed.items.every(({ success }) => !success)).toBe(true);
    expect(atomic.document.deletedAt).toBeNull();
  });
});
