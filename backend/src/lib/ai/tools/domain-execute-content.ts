import {
  archiveFolder as contentFolder, getFolderById, listFolderDescendants as defaultListFolderDescendants, restoreFolder, type Folder,
} from '@/lib/db/folders.node';
import {
  archiveDocument as contentDocument, getDocumentById, listDocumentsByScope as defaultListDocumentsByScope, restoreDocument, type Document,
} from '@/lib/db/documents.node';
import {
  archiveDocumentVersion as contentDocumentVersion, getDocumentVersionById, restoreDocumentVersion, type DocumentVersion,
} from '@/lib/db/document-versions.node';
import {
  archiveDocumentShare as contentDocumentShare, getDocumentShareById, restoreDocumentShare, type DocumentShare,
} from '@/lib/db/document-shares.node';
import type { ContentActionSlug } from './domain-content-schemas';
import { db, withTransaction } from '@/lib/db/client';
import { withContentPersistenceTransaction } from '@/lib/db/content-persistence.node';
import { withArangoKey } from '@/lib/db/base';
import { folderSchema } from '@/lib/db/folders.node';
import { documentSchema } from '@/lib/db/documents.node';
import { documentVersionSchema } from '@/lib/db/document-versions.node';
import { documentShareSchema } from '@/lib/db/document-shares.node';

type ContentNode = Folder | Document | DocumentVersion | DocumentShare;
type ContentContext = { organizationKey: string };

export interface ContentExecutionDependencies {
  authorize(scopeKey: string, roles: readonly string[]): Promise<void>;
  getFolder?: typeof getFolderById;
  getDocument?: typeof getDocumentById;
  getDocumentVersion?: typeof getDocumentVersionById;
  getDocumentShare?: typeof getDocumentShareById;
  listFolderDescendants?: typeof defaultListFolderDescendants;
  listDocumentsByScope?: typeof defaultListDocumentsByScope;
  contentFolder?: typeof contentFolder;
  restoreFolder?: typeof restoreFolder;
  contentDocument?: typeof contentDocument;
  restoreDocument?: typeof restoreDocument;
  contentDocumentVersion?: typeof contentDocumentVersion;
  restoreDocumentVersion?: typeof restoreDocumentVersion;
  contentDocumentShare?: typeof contentDocumentShare;
  restoreDocumentShare?: typeof restoreDocumentShare;
  atomicMutate?: (resource: 'folders' | 'documents' | 'documentVersions' | 'documentShares', keys: string[], deletedAt: string | null, context: ContentContext) => Promise<ContentNode[]>;
  isProjectFolder?: (folderKey: string) => Promise<boolean>;
}

export class ContentLifecycleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

async function defaultAtomicMutate(resource: 'folders' | 'documents' | 'documentVersions' | 'documentShares', keys: string[], deletedAt: string | null, context: ContentContext): Promise<ContentNode[]> {
  const timestamp = new Date().toISOString();
  if (resource === 'documentShares') {
    return withContentPersistenceTransaction(async (persistence) => {
      const values: DocumentShare[] = [];
      for (const key of keys) {
        const current = await persistence.getShare(key);
        if (!current || (deletedAt === null ? current.deletedAt === null : current.deletedAt !== null)) throw new ContentLifecycleError('content_state_changed', 'Content lifecycle state changed before the transaction committed.');
        if (!await persistence.scopeBelongsToActiveOrganization(current.scopeKey, context.organizationKey)) throw new ContentLifecycleError('content_state_changed', 'Content lifecycle authorization changed before the transaction committed.');
        const updated = await persistence.updateShare(current.scopeKey, key, { deletedAt, updatedAt: timestamp });
        if (!updated) throw new ContentLifecycleError('content_state_changed', 'Content lifecycle state changed before the transaction committed.');
        values.push(updated);
      }
      return values;
    });
  }
  const schema = resource === 'folders' ? folderSchema : resource === 'documents' ? documentSchema : resource === 'documentVersions' ? documentVersionSchema : documentShareSchema;
  const parentCollections = resource === 'folders' ? ['projects'] : resource === 'documents' ? ['folders'] : ['documents'];
  const guard = resource === 'folders'
    ? 'LET parent = node.parentFolderKey != null ? DOCUMENT("folders", node.parentFolderKey) : null LET project = FIRST(FOR candidate IN projects FILTER candidate.contentFolderKey == node._key LIMIT 1 RETURN candidate) FILTER project == null FILTER @restoring || node.isFavorite != true FILTER !@restoring || parent == null || parent.deletedAt == null'
    : resource === 'documents'
      ? 'LET parent = HAS(node, "folderKey") && node.folderKey != null ? DOCUMENT("folders", node.folderKey) : null FILTER @restoring || node.isFavorite != true FILTER !@restoring || parent == null || parent.deletedAt == null'
      : 'LET parent = DOCUMENT("documents", node.documentKey) FILTER !@restoring || (parent != null && parent.deletedAt == null)';
  return withTransaction([resource, ...parentCollections, 'scopes', ...(resource === 'folders' ? ['documents'] : [])], async (transaction) => {
    if (resource === 'folders' && deletedAt !== null) {
      const subtreeCursor = await transaction.query<{
        rootKey: string;
        folders: Array<{ key: string; parentFolderKey?: string; isFavorite?: boolean }>;
        documents: Array<{ folderKey?: string; isFavorite?: boolean }>;
      }>(
        'FOR root IN folders FILTER root._key IN @keys RETURN { rootKey: root._key, folders: (FOR folder IN folders FILTER folder.scopeKey == root.scopeKey && folder.deletedAt == null RETURN { key: folder._key, parentFolderKey: folder.parentFolderKey, isFavorite: folder.isFavorite }), documents: (FOR document IN documents FILTER document.scopeKey == root.scopeKey && document.deletedAt == null RETURN { folderKey: document.folderKey, isFavorite: document.isFavorite }) }',
        { keys },
      );
      for (const subtree of await subtreeCursor.all()) {
        const affected = new Set([subtree.rootKey]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const folder of subtree.folders) if (folder.parentFolderKey && affected.has(folder.parentFolderKey) && !affected.has(folder.key)) {
            affected.add(folder.key);
            changed = true;
          }
        }
        if (subtree.folders.some((folder) => affected.has(folder.key) && folder.isFavorite)
          || subtree.documents.some((document) => document.folderKey && affected.has(document.folderKey) && document.isFavorite)) {
          throw new ContentLifecycleError('CONTENT_CONFLICT', 'Unfavorite the folder subtree and its documents before archiving.');
        }
      }
    }
    const cursor = await transaction.query<Record<string, unknown>>(
      `FOR node IN @@collection FILTER node._key IN @keys FILTER @restoring ? node.deletedAt != null : node.deletedAt == null LET scope = DOCUMENT("scopes", node.scopeKey) FILTER scope != null && scope.organizationKey == @organizationKey && scope.deletedAt == null ${guard} UPDATE node WITH (@hasUpdatedAt ? { deletedAt: @deletedAt, updatedAt: @timestamp } : { deletedAt: @deletedAt }) IN @@collection RETURN NEW`,
      { keys, deletedAt, timestamp, restoring: deletedAt === null, hasUpdatedAt: resource !== 'documentVersions', organizationKey: context.organizationKey, '@collection': resource },
    );
    const values = (await cursor.all()).map((node) => schema.parse(withArangoKey(node)) as ContentNode);
    if (values.length !== keys.length) {
      if (deletedAt !== null && (resource === 'folders' || resource === 'documents')) throw new ContentLifecycleError('CONTENT_CONFLICT', 'Content could not be archived because its state or favorite status changed.');
      throw new ContentLifecycleError('content_state_changed', 'Content lifecycle state changed before the transaction committed.');
    }
    return values;
  });
}

async function defaultIsProjectFolder(folderKey: string): Promise<boolean> {
  const cursor = await db.query<number>('RETURN LENGTH(FOR project IN projects FILTER project.contentFolderKey == @folderKey LIMIT 1 RETURN 1)', { folderKey });
  return (await cursor.next() ?? 0) > 0;
}

function resourceFor(action: ContentActionSlug) {
  if (action.startsWith('folder.')) return { field: 'folderKey', type: 'folders' } as const;
  if (action.startsWith('document-version.')) return { field: 'documentVersionKey', type: 'documentVersions' } as const;
  if (action.startsWith('document-share.')) return { field: 'documentShareKey', type: 'documentShares' } as const;
  return { field: 'documentKey', type: 'documents' } as const;
}

export async function executeContentLifecycleTool(
  action: ContentActionSlug,
  input: { items: Array<Record<string, string>>; atomic: boolean },
  context: ContentContext,
  dependencies: ContentExecutionDependencies,
) {
  const restoring = action.endsWith('.restore');
  const resource = resourceFor(action);
  const getFolder = dependencies.getFolder ?? getFolderById;
  const getDocument = dependencies.getDocument ?? getDocumentById;
  const getVersion = dependencies.getDocumentVersion ?? getDocumentVersionById;
  const getShare = dependencies.getDocumentShare ?? getDocumentShareById;
  const listFolderDescendants = dependencies.listFolderDescendants ?? defaultListFolderDescendants;
  const listDocumentsByScope = dependencies.listDocumentsByScope ?? defaultListDocumentsByScope;

  const load = async (key: string): Promise<ContentNode | null> => {
    if (resource.type === 'folders') return getFolder(key);
    if (resource.type === 'documents') return getDocument(key);
    if (resource.type === 'documentVersions') return getVersion(key);
    return getShare(key);
  };

  const validate = async (item: Record<string, string>) => {
    const key = item[resource.field]!;
    const node = await load(key);
    if (!node) throw new ContentLifecycleError('content_node_not_found', `${resource.type} node ${key} was not found.`);
    await dependencies.authorize(node.scopeKey, ['owner', 'admin']);
    if (resource.type === 'folders' && await (dependencies.isProjectFolder ?? defaultIsProjectFolder)(key)) {
      throw new ContentLifecycleError('project_folder_lifecycle_managed', 'Project Content folders must be archived or restored through the project lifecycle tool.');
    }
    if (restoring && node.deletedAt === null) throw new ContentLifecycleError('content_node_active', `${key} is already active.`);
    if (!restoring && node.deletedAt !== null) throw new ContentLifecycleError('content_node_archived', `${key} is already archived.`);
    if (!restoring && (resource.type === 'folders' || resource.type === 'documents') && 'isFavorite' in node && node.isFavorite) {
      throw new ContentLifecycleError('CONTENT_CONFLICT', `Unfavorite the ${resource.type === 'folders' ? 'folder' : 'document'} before archiving.`);
    }
    if (!restoring && resource.type === 'folders') {
      const childFolders = await listFolderDescendants(node.scopeKey, key, false);
      if (childFolders.some((folder) => folder.deletedAt === null && folder.isFavorite)) {
        throw new ContentLifecycleError('CONTENT_CONFLICT', 'Unfavorite all descendant folders before archiving.');
      }
      const affectedFolderKeys = new Set([key, ...childFolders.filter((folder) => folder.deletedAt === null).map((folder) => folder.key)]);
      const containedDocuments = await listDocumentsByScope(node.scopeKey, { includeArchived: false });
      if (containedDocuments.some((document) => document.deletedAt === null && document.folderKey && affectedFolderKeys.has(document.folderKey) && document.isFavorite)) {
        throw new ContentLifecycleError('CONTENT_CONFLICT', 'Unfavorite all documents in the folder subtree before archiving.');
      }
    }
    if (restoring && resource.type === 'folders' && 'parentFolderKey' in node && node.parentFolderKey) {
      const parent = await getFolder(node.parentFolderKey);
      if (!parent || parent.deletedAt !== null) throw new ContentLifecycleError('content_parent_archived', 'The parent folder must be active before restore.');
    }
    if (restoring && resource.type === 'documents') {
      const folderKey = (node as Document).folderKey;
      if (folderKey) {
        const folder = await getFolder(folderKey);
        if (!folder || folder.deletedAt !== null) throw new ContentLifecycleError('content_parent_archived', 'The document folder must be active before restore.');
      }
    }
    if (restoring && (resource.type === 'documentVersions' || resource.type === 'documentShares')) {
      const document = await getDocument((node as DocumentVersion | DocumentShare).documentKey);
      if (!document || document.deletedAt !== null) throw new ContentLifecycleError('content_parent_archived', 'The owning document must be active before restore.');
    }
    return { item, key, node };
  };

  const atomicMutate = dependencies.atomicMutate ?? defaultAtomicMutate;

  if (input.atomic) {
    try {
      const prepared = await Promise.all(input.items.map(validate));
      const values = await atomicMutate(resource.type, prepared.map(({ key }) => key), restoring ? null : new Date().toISOString(), context);
      return { items: values.map((value) => ({ key: value.key, success: true, value })) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { items: input.items.map((item) => ({ key: item[resource.field], success: false, error: message })), atomic: true };
    }
  }

  const results = [];
  for (const item of input.items) {
    try {
      const target = await validate(item);
      const [value] = await atomicMutate(resource.type, [target.key], restoring ? null : new Date().toISOString(), context);
      if (!value) throw new ContentLifecycleError('content_update_failed', `${target.key} was not updated.`);
      results.push({ key: target.key, success: true, value });
    } catch (error) {
      results.push({ key: item[resource.field], success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { items: results };
}
