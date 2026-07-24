import {
  archiveFolder, getFolderById, restoreFolder, type Folder,
} from '@/lib/db/folders.node';
import {
  archiveDocument, getDocumentById, restoreDocument, type Document,
} from '@/lib/db/documents.node';
import {
  archiveDocumentVersion, getDocumentVersionById, restoreDocumentVersion, type DocumentVersion,
} from '@/lib/db/document-versions.node';
import {
  archiveDocumentShare, getDocumentShareById, restoreDocumentShare, type DocumentShare,
} from '@/lib/db/document-shares.node';
import type { ArchiveActionSlug } from './domain-archive-schemas';
import { db, withTransaction } from '@/lib/db/client';
import { withArangoKey } from '@/lib/db/base';
import { folderSchema } from '@/lib/db/folders.node';
import { documentSchema } from '@/lib/db/documents.node';
import { documentVersionSchema } from '@/lib/db/document-versions.node';
import { documentShareSchema } from '@/lib/db/document-shares.node';
import { newId } from '@/lib/ids';

type ArchiveNode = Folder | Document | DocumentVersion | DocumentShare;
type ArchiveContext = { organizationKey: string; runtimeScopeKey: string; userKey?: string };

export interface ArchiveExecutionDependencies {
  authorize(scopeKey: string, roles: readonly string[]): Promise<void>;
  emit(action: ArchiveActionSlug, data: Record<string, unknown>): Promise<void>;
  getFolder?: typeof getFolderById;
  getDocument?: typeof getDocumentById;
  getDocumentVersion?: typeof getDocumentVersionById;
  getDocumentShare?: typeof getDocumentShareById;
  archiveFolder?: typeof archiveFolder;
  restoreFolder?: typeof restoreFolder;
  archiveDocument?: typeof archiveDocument;
  restoreDocument?: typeof restoreDocument;
  archiveDocumentVersion?: typeof archiveDocumentVersion;
  restoreDocumentVersion?: typeof restoreDocumentVersion;
  archiveDocumentShare?: typeof archiveDocumentShare;
  restoreDocumentShare?: typeof restoreDocumentShare;
  atomicMutate?: (resource: 'folders' | 'documents' | 'documentVersions' | 'documentShares', keys: string[], deletedAt: string | null, action: ArchiveActionSlug, context: ArchiveContext) => Promise<ArchiveNode[]>;
  isProjectFolder?: (folderKey: string) => Promise<boolean>;
}

export class ArchiveLifecycleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

async function defaultAtomicMutate(resource: 'folders' | 'documents' | 'documentVersions' | 'documentShares', keys: string[], deletedAt: string | null, action: ArchiveActionSlug, context: ArchiveContext): Promise<ArchiveNode[]> {
  const timestamp = new Date().toISOString();
  const schema = resource === 'folders' ? folderSchema : resource === 'documents' ? documentSchema : resource === 'documentVersions' ? documentVersionSchema : documentShareSchema;
  const parentCollections = resource === 'folders' ? ['projects'] : resource === 'documents' ? ['folders'] : ['documents'];
  const guard = resource === 'folders'
    ? 'LET parent = node.parentFolderKey != null ? DOCUMENT("folders", node.parentFolderKey) : null LET project = FIRST(FOR candidate IN projects FILTER candidate.archiveFolderKey == node._key LIMIT 1 RETURN candidate) FILTER project == null FILTER !@restoring || parent == null || parent.deletedAt == null'
    : resource === 'documents'
      ? 'LET parent = DOCUMENT("folders", node.folderKey) FILTER !@restoring || (parent != null && parent.deletedAt == null)'
      : 'LET parent = DOCUMENT("documents", node.documentKey) FILTER !@restoring || (parent != null && parent.deletedAt == null)';
  return withTransaction([resource, ...parentCollections, 'events', 'scopes'], async (transaction) => {
    const cursor = await transaction.query<Record<string, unknown>>(
      `FOR node IN @@collection FILTER node._key IN @keys FILTER @restoring ? node.deletedAt != null : node.deletedAt == null LET scope = DOCUMENT("scopes", node.scopeKey) FILTER scope != null && scope.organizationKey == @organizationKey && scope.deletedAt == null ${guard} UPDATE node WITH { deletedAt: @deletedAt, updatedAt: @timestamp } IN @@collection RETURN NEW`,
      { keys, deletedAt, timestamp, restoring: deletedAt === null, organizationKey: context.organizationKey, '@collection': resource },
    );
    const values = (await cursor.all()).map((node) => schema.parse(withArangoKey(node)) as ArchiveNode);
    if (values.length !== keys.length) throw new ArchiveLifecycleError('archive_state_changed', 'Archive lifecycle state changed before the transaction committed.');
    await transaction.query(
      'INSERT @event IN events',
      { event: { _key: newId(), scopeId: context.runtimeScopeKey, userId: context.userKey ?? null, slug: action, data: { nodeType: resource, nodeKeys: keys }, embedding: [], createdAt: timestamp } },
    );
    return values;
  });
}

async function defaultIsProjectFolder(folderKey: string): Promise<boolean> {
  const cursor = await db.query<number>('RETURN LENGTH(FOR project IN projects FILTER project.archiveFolderKey == @folderKey LIMIT 1 RETURN 1)', { folderKey });
  return (await cursor.next() ?? 0) > 0;
}

async function safeEmit(emit: ArchiveExecutionDependencies['emit'], action: ArchiveActionSlug, data: Record<string, unknown>): Promise<void> {
  try { await emit(action, data); }
  catch (error) { console.warn('Archive lifecycle audit event failed', { action, error: error instanceof Error ? error.message : String(error) }); }
}

function resourceFor(action: ArchiveActionSlug) {
  if (action.startsWith('folder.')) return { field: 'folderKey', type: 'folders' } as const;
  if (action.startsWith('document-version.')) return { field: 'documentVersionKey', type: 'documentVersions' } as const;
  if (action.startsWith('document-share.')) return { field: 'documentShareKey', type: 'documentShares' } as const;
  return { field: 'documentKey', type: 'documents' } as const;
}

export async function executeArchiveLifecycleTool(
  action: ArchiveActionSlug,
  input: { items: Array<Record<string, string>>; atomic: boolean },
  context: ArchiveContext,
  dependencies: ArchiveExecutionDependencies,
) {
  const restoring = action.endsWith('.restore');
  const resource = resourceFor(action);
  const getFolder = dependencies.getFolder ?? getFolderById;
  const getDocument = dependencies.getDocument ?? getDocumentById;
  const getVersion = dependencies.getDocumentVersion ?? getDocumentVersionById;
  const getShare = dependencies.getDocumentShare ?? getDocumentShareById;

  const load = async (key: string): Promise<ArchiveNode | null> => {
    if (resource.type === 'folders') return getFolder(key);
    if (resource.type === 'documents') return getDocument(key);
    if (resource.type === 'documentVersions') return getVersion(key);
    return getShare(key);
  };

  const validate = async (item: Record<string, string>) => {
    const key = item[resource.field]!;
    const node = await load(key);
    if (!node) throw new ArchiveLifecycleError('archive_node_not_found', `${resource.type} node ${key} was not found.`);
    await dependencies.authorize(node.scopeKey, ['owner', 'admin']);
    if (resource.type === 'folders' && await (dependencies.isProjectFolder ?? defaultIsProjectFolder)(key)) {
      throw new ArchiveLifecycleError('project_folder_lifecycle_managed', 'Project Archive folders must be archived or restored through the project lifecycle tool.');
    }
    if (restoring && node.deletedAt === null) throw new ArchiveLifecycleError('archive_node_active', `${key} is already active.`);
    if (!restoring && node.deletedAt !== null) throw new ArchiveLifecycleError('archive_node_archived', `${key} is already archived.`);
    if (restoring && resource.type === 'folders' && 'parentFolderKey' in node && node.parentFolderKey) {
      const parent = await getFolder(node.parentFolderKey);
      if (!parent || parent.deletedAt !== null) throw new ArchiveLifecycleError('archive_parent_archived', 'The parent folder must be active before restore.');
    }
    if (restoring && resource.type === 'documents') {
      const folder = await getFolder((node as Document).folderKey);
      if (!folder || folder.deletedAt !== null) throw new ArchiveLifecycleError('archive_parent_archived', 'The document folder must be active before restore.');
    }
    if (restoring && (resource.type === 'documentVersions' || resource.type === 'documentShares')) {
      const document = await getDocument((node as DocumentVersion | DocumentShare).documentKey);
      if (!document || document.deletedAt !== null) throw new ArchiveLifecycleError('archive_parent_archived', 'The owning document must be active before restore.');
    }
    return { item, key, node };
  };

  const atomicMutate = dependencies.atomicMutate ?? defaultAtomicMutate;
  const emitsInsideTransaction = dependencies.atomicMutate === undefined;

  if (input.atomic) {
    try {
      const prepared = await Promise.all(input.items.map(validate));
      const values = await atomicMutate(resource.type, prepared.map(({ key }) => key), restoring ? null : new Date().toISOString(), action, context);
      if (!emitsInsideTransaction) await safeEmit(dependencies.emit, action, { nodeType: resource.type, nodeKeys: values.map(({ key }) => key) });
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
      const [value] = await atomicMutate(resource.type, [target.key], restoring ? null : new Date().toISOString(), action, context);
      if (!value) throw new ArchiveLifecycleError('archive_update_failed', `${target.key} was not updated.`);
      if (!emitsInsideTransaction) await safeEmit(dependencies.emit, action, { nodeType: resource.type, nodeKey: value.key });
      results.push({ key: target.key, success: true, value });
    } catch (error) {
      results.push({ key: item[resource.field], success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { items: results };
}
