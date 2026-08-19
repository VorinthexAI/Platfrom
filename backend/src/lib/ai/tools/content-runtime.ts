import { createHash, randomBytes, scrypt as nodeScrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { ActionId } from '@/lib/ai/actions';
import type { ToolContext } from './tool-context';
import type { DocumentParseDependencies, DocumentParseInput } from '@/lib/ai/document-processing';
import type { RouterDependencies } from '@/lib/ai/router';
import type { DocumentObjectStorage } from '@/lib/ai/document-processing/storage';
import type { Folder } from '@/lib/db/folders.node';
import type { Document } from '@/lib/db/documents.node';
import type { DocumentAudioVersion } from '@/lib/db/document-audio-versions.node';
import type { DocumentSummary } from '@/lib/db/document-summaries.node';
import type { DocumentSummaryAudio } from '@/lib/db/document-summary-audio.node';
import type { DocumentShare } from '@/lib/db/document-shares.node';
import { documentVersionSchema, type DocumentVersion } from '@/lib/db/document-versions.node';
import { DocumentProcessingError } from '@/lib/ai/document-processing/errors';
import type { generateDocumentExport } from '@/lib/ai/document-processing/exports';
import type { generateDocumentPreview } from '@/lib/ai/document-processing/preview';
import type { ContentToolName, ContentToolOutput } from './content-schemas';
import { ContentError, type ContentErrorCode } from './content-errors';
import { contentToolInputSchemas, contentToolOutputSchemas, isContentToolName } from './content-registry';
import { documentCleanup } from '@/lib/ai/document-processing/actions';
import { sanitizeDocumentContent } from '@/lib/ai/document-processing/actions';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { chunkDocumentContent, documentSemanticHash } from '@/lib/ai/document-processing/chunking';
import type { DocumentScanInput } from '@/lib/ai/document-scanning';
import type { UserSearchService } from '@/lib/user-searches/service';

type Role = 'viewer' | 'moderator' | 'admin' | 'owner';
type SafeEvent = {
  type: 'authorization' | 'resolution' | 'action' | 'db' | 'embedding' | 'storage' | 'speech' | 'cleanup';
  status: 'started' | 'succeeded' | 'failed';
  tool: ContentToolName;
  invocationKey: string;
  action?: string;
  resourceKey?: string;
  scopeKey?: string;
  retryable?: boolean;
  durationMs?: number;
};

export interface ContentIdempotencyStore {
  claim(identity: { organizationKey: string; actorKey: string; tool: string; idempotencyKey: string }, requestHash: string, leaseOwner: string, now: string): Promise<{ status: 'claimed' } | { status: 'pending' } | { status: 'conflict' } | { status: 'replay'; response: unknown }>;
  complete(identity: { organizationKey: string; actorKey: string; tool: string; idempotencyKey: string }, requestHash: string, leaseOwner: string, response: unknown, now: string): Promise<void>;
  release(identity: { organizationKey: string; actorKey: string; tool: string; idempotencyKey: string }, requestHash: string, leaseOwner: string): Promise<void>;
}

export interface ContentRepository {
  getScope(scopeKey: string): Promise<{ key: string; organizationKey: string } | null>;
  role(scopeKey: string, membershipKey: string): Promise<Role | null>;
  allowedScopeKeys(organizationKey: string, membershipKey: string): Promise<string[]>;
  getFolder(key: string): Promise<Folder | null>;
  listFolders(scopeKey: string, includePendingDeletion?: boolean): Promise<Folder[]>;
  insertFolder(folder: Folder): Promise<Folder>;
  updateFolder(key: string, patch: Partial<Folder>): Promise<Folder>;
  setFolderDeletion(key: string, marker: Folder['_internalDeletion'] | undefined, owner?: string): Promise<Folder | null>;
  deleteFolder(key: string): Promise<void>;
  getDocument(key: string): Promise<Document | null>;
  listDocuments(scopeKey: string, includePendingDeletion?: boolean): Promise<Document[]>;
  insertDocument(document: Document): Promise<Document>;
  updateDocument(key: string, patch: Partial<Document>, options?: { expectedUpdatedAt?: string }): Promise<Document>;
  setDocumentDeletion(key: string, marker: Document['_internalDeletion'] | undefined, owner?: string): Promise<Document | null>;
  deleteDocument(key: string): Promise<void>;
  getShare(key: string): Promise<DocumentShare | null>;
  listShares(scopeKey: string, documentKeys: string[], options?: { includeExpired?: boolean; includeRevoked?: boolean; at?: string }): Promise<DocumentShare[]>;
  insertShare(share: DocumentShare): Promise<DocumentShare>;
  updateShare(key: string, patch: Partial<DocumentShare>): Promise<DocumentShare>;
  deleteShare(key: string): Promise<void>;
  getVersion(key: string): Promise<DocumentVersion | null>;
  listVersions(scopeKey: string, documentKeys: string[]): Promise<DocumentVersion[]>;
  createVersion(version: Omit<DocumentVersion, 'key' | 'version' | 'createdAt'>): Promise<DocumentVersion>;
  deleteVersion(key: string): Promise<void>;
  listAudioVersions?(scopeKey: string, documentKeys: string[]): Promise<DocumentAudioVersion[]>;
  getAudioVersion?(key: string): Promise<DocumentAudioVersion | null>;
  createAudioVersion?(version: Omit<DocumentAudioVersion, 'version' | 'isCurrent' | 'playbackPositionMs'> & Partial<Pick<DocumentAudioVersion, 'isCurrent' | 'playbackPositionMs'>>): Promise<DocumentAudioVersion>;
  updateAudioPlayback?(scopeKey: string, key: string, playbackPositionMs: number): Promise<DocumentAudioVersion | null>;
  clearCurrentAudioVersion?(scopeKey: string, documentKey: string): Promise<boolean>;
  deleteAudioVersion?(key: string): Promise<void>;
  getSummary?(key: string): Promise<DocumentSummary | null>;
  listSummaries?(scopeKey: string, documentKeys: string[]): Promise<DocumentSummary[]>;
  createSummary?(summary: Omit<DocumentSummary, 'version'>): Promise<DocumentSummary>;
  deleteSummary?(key: string): Promise<void>;
  getSummaryAudio?(summaryKey: string): Promise<DocumentSummaryAudio | null>;
  listSummaryAudio?(scopeKey: string, summaryKeys: string[]): Promise<DocumentSummaryAudio[]>;
  createSummaryAudio?(audio: DocumentSummaryAudio): Promise<{ audio: DocumentSummaryAudio; created: boolean }>;
  deleteSummaryAudio?(summaryKey: string): Promise<void>;
  semanticSearch(input: { embedding: number[]; authorizedScopeKeys: string[]; folderKeys?: string[]; documentKeys?: string[]; extensions?: Document['extension'][]; createdAfter?: string; createdBefore?: string; updatedAfter?: string; updatedBefore?: string; minScore?: number; limit?: number }): Promise<Array<{ score: number; document: Document; matchedContent?: string }>>;
  semanticSearchFolders?(input: { embedding: number[]; authorizedScopeKeys: string[]; folderKeys?: string[]; minScore: number; limit: number }): Promise<Array<{ score: number; folder: Folder }>>;
  semanticNeighbors?(input: { embedding: number[]; scopeKey: string; activeFolderKeys: string[]; sourceFolderKey?: string; sourceDocumentKey?: string; limit: number }): Promise<{ folders: Array<{ score: number; folder: Folder }>; documents: Array<{ score: number; document: Document }>; files: Array<{ score: number; document: Document }> }>;
  transaction?<T>(operation: (repository: ContentRepository) => Promise<T>): Promise<T>;
}

export interface ContentSearchQueryStore {
  get(input: { actorKey: string; scopeKey: string; normalizedQuery: string; folderKey: string | null; includeDescendants: boolean; cacheVersion: number }): Promise<{ output: unknown } | null>;
  record(input: { key: string; actorKey: string; scopeKey: string; query: string; normalizedQuery: string; folderKey: string | null; includeDescendants: boolean; cacheVersion: number; output: unknown; now: string }): Promise<void>;
}

export interface ContentActionResult { text?: string; content?: string; embedding?: number[]; contentChunks?: string[]; chunkEmbeddings?: number[][]; semanticChunkCount?: number; semanticContentHash?: string }
export interface ContentToolDependencies extends RouterDependencies {
  signal?: AbortSignal;
  repository?: ContentRepository;
  storage?: DocumentObjectStorage;
  parseDocument?: (input: DocumentParseInput, dependencies?: DocumentParseDependencies) => Promise<{ document: Document }>;
  runAction?: (action: ActionId, input: Record<string, unknown>, context: ToolContext) => Promise<ContentActionResult>;
  executeAction?: typeof import('@/lib/ai/router').executeAction;
  embed?: (text: string) => Promise<number[]>;
  embedBatch?: (texts: string[]) => Promise<number[][]>;
  observer?: (event: SafeEvent) => void | Promise<void>;
  clock?: () => Date;
  id?: () => string;
  random?: (size: number) => Uint8Array;
  ingestion?: DocumentParseDependencies;
  idempotency?: ContentIdempotencyStore;
  maxDownloadBytes?: number;
  generateExport?: typeof generateDocumentExport;
  generatePreview?: typeof generateDocumentPreview;
  searchQueries?: ContentSearchQueryStore;
  userSearches?: UserSearchService;
  searchEmbeddingTimeoutMs?: number;
  scanDocument?: (input: DocumentScanInput, organizationKey: string) => Promise<{ documentKey: string; content: string; storageKeys: string[] }>;
  getFolderCoverImage?: (scopeKey: string, imageKey: string) => Promise<{ storageKey: string } | null>;
  signFolderCoverUrl?: (storageKey: string) => Promise<string>;
  signDocumentSourceUrl?: (storageKey: string) => Promise<string>;
  signAudioUrl?: (storageKey: string) => Promise<string>;
}

const rank: Record<Role, number> = { viewer: 1, moderator: 2, admin: 3, owner: 4 };
const ROUTED_EMBEDDING_CONCURRENCY = 8;
const CONTENT_SEARCH_CACHE_VERSION = 4;
const scrypt = promisify(nodeScrypt);
const MUTATIONS = new Set<ContentToolName>([
  'folder.create', 'folder.update', 'folder.rename', 'folder.move', 'folder.copy', 'folder.delete', 'document.parse', 'document.scan', 'document.create', 'document.update', 'document.rename', 'document.move', 'document.copy', 'document.delete', 'document.share', 'document.unshare', 'document.create-version', 'document.restore-version', 'document.delete-version', 'document.audio.playback.update', 'document.audio.playback.clear', 'document.summarize', 'document.translate', 'document.rewrite', 'content.search-history.delete',
]);

function fail(code: ContentErrorCode, message: string, tool: ContentToolName, action?: string, resourceKey?: string, cause?: unknown, retryable = false): never {
  throw new ContentError(code, message, tool, { action, resourceKey, cause, retryable });
}

function mappedError(error: unknown, tool: ContentToolName, action?: string, resourceKey?: string): ContentError {
  if (error instanceof ContentError) return error;
  if (error instanceof DocumentProcessingError) {
    const codeByAction: Partial<Record<string, ContentErrorCode>> = {
      'document-validate': error.code === 'DOCUMENT_TOO_LARGE' ? 'DOCUMENT_TOO_LARGE' : error.code === 'DOCUMENT_INVALID_MIME_TYPE' ? 'DOCUMENT_INVALID_MIME_TYPE' : 'DOCUMENT_UNSUPPORTED_TYPE',
      'document-extract': 'DOCUMENT_EXTRACTION_FAILED',
      'document-embed': 'DOCUMENT_EMBEDDING_FAILED',
      'document-insert': 'DOCUMENT_INSERT_FAILED',
    };
    return new ContentError(codeByAction[error.action] ?? 'DOCUMENT_PROCESSING_FAILED', error.message, tool, {
      action: error.action,
      resourceKey,
      retryable: error.retryable,
    });
  }
  const validation = error && typeof error === 'object' && ('issues' in error || ('name' in error && error.name === 'ZodError'));
  return new ContentError(validation ? 'CONTENT_INVALID_INPUT' : 'CONTENT_CONFLICT', validation ? 'Content tool input or output was invalid.' : 'Content operation failed.', tool, { action, resourceKey, cause: error, retryable: !validation });
}

async function folderView(folder: Folder, dependencies: Pick<RuntimeDefaults, 'getFolderCoverImage' | 'signFolderCoverUrl'>) {
  const { embedding: _embedding, coverImageKey, _internalDeletion: _internalDeletion, ...safe } = folder;
  if (!coverImageKey) return safe;
  const image = await dependencies.getFolderCoverImage(folder.scopeKey, coverImageKey);
  return { ...safe, ...(image ? { coverUrl: await dependencies.signFolderCoverUrl(image.storageKey) } : {}) };
}

function documentView(document: Document) {
  const { content: _content, embedding: _embedding, contentChunks: _contentChunks, chunkEmbeddings: _chunkEmbeddings, semanticChunkCount: _semanticChunkCount, semanticContentHash: _semanticContentHash, _semanticChunkingSkipped: _semanticChunkingSkipped, storageKey: _storageKey, speechStorageKeys: _speechStorageKeys, sourceStorageKeys: _sourceStorageKeys, _internalDeletion: _internalDeletion, ...safe } = document;
  return { ...safe, ...(document.sourceStorageKeys?.length ? { sourceImageCount: document.sourceStorageKeys.length } : {}) };
}

function downloadFileName(name: string, extension: string) {
  const suffix = `.${extension}`;
  return `${name.slice(0, 255 - suffix.length)}${suffix}`;
}

function shareView(share: DocumentShare) {
  const { tokenHash: _tokenHash, passwordHash: _passwordHash, ...safe } = share;
  return safe;
}

function versionView(version: DocumentVersion, include: string[] = []) {
  const { embedding, chunkEmbeddings: _chunkEmbeddings, semanticChunkCount: _semanticChunkCount, semanticContentHash: _semanticContentHash, _semanticChunkingSkipped: _semanticChunkingSkipped, content, ...safe } = version;
  return { ...safe, ...(include.includes('content') ? { content } : {}), ...(include.includes('embedding') ? { embedding } : {}) };
}

function generatedAudioVersionView(version: DocumentAudioVersion) {
  const { storageKey: _storageKey, createdByKey: _createdByKey, scopeKey: _scopeKey, ...safe } = version;
  return safe;
}

function summaryView(summary: DocumentSummary) {
  const { createdByKey: _createdByKey, scopeKey: _scopeKey, ...safe } = summary;
  return safe;
}

async function summaryAudioView(audio: DocumentSummaryAudio, signUrl: (storageKey: string) => Promise<string>) {
  const { storageKey: _storageKey, createdByKey: _createdByKey, scopeKey: _scopeKey, documentKey: _documentKey, ...safe } = audio;
  return { ...safe, url: await signUrl(audio.storageKey) };
}

async function projectedSummaryView(summary: DocumentSummary, audio: DocumentSummaryAudio | undefined, signUrl: (storageKey: string) => Promise<string>) {
  return { ...summaryView(summary), ...(audio ? { audio: await summaryAudioView(audio, signUrl) } : {}) };
}

function plainGeneratedSummary(value: unknown) {
  return z.string().trim().min(1).parse(value)
    .replace(/<(?:analysis|thinking|reasoning)>[\s\S]*?<\/(?:analysis|thinking|reasoning)>/gi, '')
    .replace(/^```(?:markdown|text)?\s*\n?/i, '')
    .replace(/\n?```$/i, '')
    .replace(/```(?:markdown|text)?\s*([\s\S]*?)```/gi, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const generatedSummarySectionsSchema = z.object({
  sections: z.array(z.object({
    heading: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1),
  }).strict()).min(2).max(4),
}).strict();

function sectionedGeneratedSummary(value: unknown) {
  const raw = z.string().trim().min(1).parse(value)
    .replace(/<(?:analysis|thinking|reasoning)>[\s\S]*?<\/(?:analysis|thinking|reasoning)>/gi, '')
    .trim();
  const candidates = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]!.trim());
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(raw.slice(firstBrace, lastBrace + 1));
  candidates.push(raw);
  for (const candidate of candidates) {
    try {
      const parsed = generatedSummarySectionsSchema.parse(JSON.parse(candidate));
      return parsed.sections.map(({ heading, body }) => `${plainGeneratedSummary(heading)}\n${plainGeneratedSummary(body)}`).join('\n\n');
    } catch {
      // Try the next JSON candidate before accepting a plain-text fallback.
    }
  }
  if (firstBrace >= 0 || lastBrace >= 0) throw new Error('The summary model returned malformed structured output.');
  const plain = plainGeneratedSummary(raw).replace(/^(?:sure[,!.]?\s*|here(?:'s| is) (?:the |a )?summary:?\s*)/i, '').trim();
  return `Summary\n${z.string().min(1).parse(plain)}`;
}

async function audioVersionView(version: DocumentAudioVersion, current: Document, signUrl: (storageKey: string) => Promise<string>) {
  return {
    ...generatedAudioVersionView(version),
    current: version.sourceContentHash === documentSemanticHash(current.content) && (!version.includeTitle || version.sourceTitle === current.name),
    url: await signUrl(version.storageKey),
  };
}

async function productionRepository(): Promise<ContentRepository> {
  const [documents, folders, client, content] = await Promise.all([
    import('@/lib/db/documents.node'),
    import('@/lib/db/folders.node'),
    import('@/lib/db/client'),
    import('@/lib/db/content-persistence.node'),
  ]);
  const allowedScopeKeys = async (organizationKey: string, membershipKey: string): Promise<string[]> => {
    const cursor = await client.db.query<{ orgRole?: string; scopes: string[]; members: string[]; relations: Array<{ parentKey: string; childKey: string }> }>(
      'LET membership = DOCUMENT(userOrganizations, @membershipKey) RETURN { orgRole: membership.orgRole, scopes: (FOR scope IN scopes FILTER scope.organizationKey == @organizationKey RETURN scope._key), members: (FOR member IN scopeMembers FILTER member.userOrganizationKey == @membershipKey && member.status == "active" RETURN member.scopeKey), relations: (FOR relation IN scopeScopes RETURN { parentKey: relation.parentKey, childKey: relation.childKey }) }',
      { organizationKey, membershipKey },
    );
    const data = await cursor.next();
    if (!data) return [];
    if (data.orgRole === 'owner' || data.orgRole === 'admin') return data.scopes;
    const accessible = new Set(data.members);
    let changed = true;
    while (changed) {
      changed = false;
      for (const relation of data.relations) {
        if (accessible.has(relation.parentKey) && !accessible.has(relation.childKey)) {
          accessible.add(relation.childKey);
          changed = true;
        }
      }
    }
    return data.scopes.filter((key) => accessible.has(key));
  };

  type Persistence = ReturnType<typeof content.createContentPersistence>;
  const makeRepository = (persistence: Persistence): ContentRepository => ({
    getScope: persistence.getScope,
    role: persistence.role,
    allowedScopeKeys,
    getFolder: persistence.getFolder,
    async listFolders(scopeKey, includePendingDeletion) { return persistence.listFolders(scopeKey, includePendingDeletion); },
    insertFolder: persistence.insertFolder,
    async updateFolder(key, patch) {
      const current = await persistence.getFolder(key);
      if (!current) throw new Error('Folder was not found for scoped update.');
      const updated = await persistence.updateFolder(current.scopeKey, key, patch);
      if (!updated) throw new Error('Folder scope changed during update.');
      return updated;
    },
    async setFolderDeletion(key, marker, owner) {
      const current = await persistence.getFolder(key);
      if (!current) return null;
      return persistence.setFolderDeletion(current.scopeKey, key, marker, owner);
    },
    async deleteFolder(key) {
      const current = await persistence.getFolder(key);
      if (!current || !await persistence.deleteFolder(current.scopeKey, key)) throw new Error('Folder was not found for scoped deletion.');
    },
    getDocument: persistence.getDocument,
    async listDocuments(scopeKey, includePendingDeletion) { return persistence.listDocuments(scopeKey, includePendingDeletion); },
    insertDocument: persistence.insertDocument,
    async updateDocument(key, patch, options) {
      const current = await persistence.getDocument(key);
      if (!current) throw new Error('Document was not found for scoped update.');
      const updated = await persistence.updateDocument(current.scopeKey, key, patch, options);
      if (!updated) throw new Error(options?.expectedUpdatedAt ? 'Document update conflict.' : 'Document scope changed during update.');
      return updated;
    },
    async setDocumentDeletion(key, marker, owner) {
      const current = await persistence.getDocument(key);
      if (!current) return null;
      return persistence.setDocumentDeletion(current.scopeKey, key, marker, owner);
    },
    async deleteDocument(key) {
      const current = await persistence.getDocument(key);
      if (!current || !await persistence.deleteDocument(current.scopeKey, key)) throw new Error('Document was not found for scoped deletion.');
    },
    getShare: persistence.getShare,
    async listShares(scopeKey, documentKeys, options) {
      const values = await persistence.listShares(scopeKey, documentKeys, options);
      const at = options?.at ?? new Date().toISOString();
      return values.filter((share) => (options?.includeRevoked || !share.revokedAt) && (options?.includeExpired || !share.expiresAt || share.expiresAt > at));
    },
    insertShare: persistence.insertShare,
    async updateShare(key, patch) {
      const current = await persistence.getShare(key);
      if (!current) throw new Error('Share was not found for scoped update.');
      const updated = await persistence.updateShare(current.scopeKey, key, patch);
      if (!updated) throw new Error('Share scope changed during update.');
      return updated;
    },
    async deleteShare(key) {
      const current = await persistence.getShare(key);
      if (!current || !await persistence.deleteShare(current.scopeKey, key)) throw new Error('Share was not found for scoped deletion.');
    },
    getVersion: persistence.getVersion,
    listVersions: persistence.listVersions,
    createVersion: persistence.createVersion,
    async deleteVersion(key) {
      const current = await persistence.getVersion(key);
      if (!current || !await persistence.deleteVersion(current.scopeKey, key)) throw new Error('Version was not found for scoped deletion.');
    },
    listAudioVersions: persistence.listAudioVersions,
    getAudioVersion: persistence.getAudioVersion,
    createAudioVersion: persistence.createAudioVersion,
    updateAudioPlayback: persistence.updateAudioPlayback,
    clearCurrentAudioVersion: persistence.clearCurrentAudioVersion,
    async deleteAudioVersion(key) {
      const current = await persistence.getAudioVersion(key);
      if (!current || !await persistence.deleteAudioVersion(current.scopeKey, key)) throw new Error('Audio version was not found for scoped deletion.');
    },
    getSummary: persistence.getSummary,
    listSummaries: persistence.listSummaries,
    createSummary: persistence.createSummary,
    async deleteSummary(key) {
      const current = await persistence.getSummary(key);
      if (!current || !await persistence.deleteSummary(current.scopeKey, key)) throw new Error('Summary was not found for scoped deletion.');
    },
    getSummaryAudio: persistence.getSummaryAudio,
    listSummaryAudio: persistence.listSummaryAudio,
    createSummaryAudio: persistence.createSummaryAudio,
    async deleteSummaryAudio(summaryKey) {
      const current = await persistence.getSummaryAudio(summaryKey);
      if (!current || !await persistence.deleteSummaryAudio(current.scopeKey, current.key)) throw new Error('Summary audio was not found for scoped deletion.');
    },
    semanticSearch: documents.semanticSearchDocuments,
    semanticSearchFolders: folders.semanticSearchFolders,
    semanticNeighbors: persistence.semanticNeighbors,
    transaction: (operation) => content.withContentPersistenceTransaction((bound) => operation(makeRepository(bound))),
  });
  return makeRepository(content.contentPersistence);
}

/** Performs the complete cheap authorization/location preflight before queued ingestion spends compute. */
export async function authorizeDocumentParseLocation(input: { scopeKey: string; folderKey?: string }, context: ToolContext, repository?: ContentRepository): Promise<void> {
  if (context.principal.kind !== 'member') throw new ContentError('CONTENT_FORBIDDEN', 'A member principal is required.', 'document.parse', { action: 'authorization' });
  const repo = repository ?? await productionRepository();
  const scope = await repo.getScope(input.scopeKey);
  if (!scope || scope.organizationKey !== context.organizationKey) throw new ContentError('CONTENT_NOT_FOUND', 'Scope was not found in this organization.', 'document.parse', { action: 'resolution' });
  const organizationRole = context.principal.userOrganization.orgRole;
  const role: Role | null = organizationRole === 'owner' || organizationRole === 'admin' ? organizationRole : await repo.role(input.scopeKey, context.principal.userOrganization.key);
  if (!role || rank[role] < rank.moderator) throw new ContentError('CONTENT_FORBIDDEN', 'The principal lacks the required scope role.', 'document.parse', { action: 'authorization' });
  let folderKey = input.folderKey;
  const visited = new Set<string>();
  while (folderKey) {
    if (visited.has(folderKey)) throw new ContentError('FOLDER_CYCLE_DETECTED', 'The folder hierarchy contains a cycle.', 'document.parse', { action: 'resolution', resourceKey: folderKey });
    visited.add(folderKey);
    const folder = await repo.getFolder(folderKey);
    if (!folder) throw new ContentError('CONTENT_NOT_FOUND', 'Folder was not found.', 'document.parse', { action: 'read', resourceKey: folderKey });
    if (folder.scopeKey !== input.scopeKey) throw new ContentError('CONTENT_FORBIDDEN', 'Folder does not belong to the requested scope.', 'document.parse', { action: 'authorization', resourceKey: folderKey });
    if (folder._internalDeletion) throw new ContentError('CONTENT_NOT_FOUND', 'Folder was not found.', 'document.parse', { action: 'read', resourceKey: folderKey });
    folderKey = folder.parentFolderKey;
  }
}

interface RuntimeDefaults {
  repository: ContentRepository;
  storage: DocumentObjectStorage;
  parseDocument: NonNullable<ContentToolDependencies['parseDocument']>;
  id: () => string;
  clock: () => Date;
  random: (size: number) => Uint8Array;
  embed: (text: string, purpose?: 'document' | 'query') => Promise<number[]>;
  embedBatch: (texts: string[], purpose?: 'document' | 'query') => Promise<number[][]>;
  runAction: NonNullable<ContentToolDependencies['runAction']>;
  idempotency: ContentIdempotencyStore;
  generateExport: typeof generateDocumentExport;
  getFolderCoverImage: NonNullable<ContentToolDependencies['getFolderCoverImage']>;
  signFolderCoverUrl: NonNullable<ContentToolDependencies['signFolderCoverUrl']>;
  signDocumentSourceUrl: NonNullable<ContentToolDependencies['signDocumentSourceUrl']>;
  signAudioUrl: NonNullable<ContentToolDependencies['signAudioUrl']>;
}

async function defaults(deps: ContentToolDependencies, context: ToolContext): Promise<RuntimeDefaults> {
  const [{ newId }, storage, processing, embeddings, router, ledger, exports, images, imageUrl, audioUrl] = await Promise.all([
    import('@/lib/ids'),
    import('@/lib/ai/document-processing/storage'),
    import('@/lib/ai/document-processing'),
    import('@/lib/embeddings'),
    import('@/lib/ai/router'),
    import('@/lib/db/content-idempotency.node'),
    import('@/lib/ai/document-processing/exports'),
    import('@/lib/db/images.node'),
    import('@/lib/gallery/image-url'),
    import('@/lib/ai/audio/audio-url'),
  ]);
  const executeAction = deps.executeAction ?? router.executeAction;
  const embedding = deps.embed ? (text: string) => deps.embed!(text) : async (text: string, purpose: 'document' | 'query' = 'document') => {
    const response = await executeAction<Record<string, unknown>, ContentActionResult>(
      { mode: 'auto', organizationKey: context.organizationKey, actionSlug: 'embed' },
      { text: embeddings.prepareEmbeddingText(text, purpose) },
      deps,
    );
    return z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS).parse(response.output.embedding);
  };
  const embeddingBatch = deps.embedBatch
    ? (texts: string[]) => deps.embedBatch!(texts)
    : deps.embed
      ? (texts: string[]) => Promise.all(texts.map((text) => deps.embed!(text)))
      : async (texts: string[], purpose: 'document' | 'query' = 'document') => {
        const values: number[][] = [];
        for (let start = 0; start < texts.length; start += ROUTED_EMBEDDING_CONCURRENCY) {
          values.push(...await Promise.all(texts.slice(start, start + ROUTED_EMBEDDING_CONCURRENCY).map((text) => embedding(text, purpose))));
        }
        return values;
      };
  return {
    repository: deps.repository ?? await productionRepository(), storage: deps.storage ?? storage.documentStorage,
    parseDocument: deps.parseDocument ?? processing.parseDocument, id: deps.id ?? newId, clock: deps.clock ?? (() => new Date()), random: deps.random ?? randomBytes,
    embed: embedding,
    embedBatch: embeddingBatch,
    runAction: deps.runAction ?? (async (action: ActionId, input: Record<string, unknown>): Promise<ContentActionResult> => {
      if (action === 'document-embed') return processing.documentEmbed(input as never, { embedBatch: ({ texts }) => embeddingBatch(texts), dimensions: deps.ingestion?.embeddingDimensions }) as Promise<ContentActionResult>;
      const request = { mode: 'auto' as const, organizationKey: context.organizationKey, actionSlug: action };
      const response = await executeAction<Record<string, unknown>, ContentActionResult>(request, input, deps);
      return response.output;
    }),
    idempotency: deps.idempotency ?? {
      claim: ledger.claimContentIdempotency,
      complete: ledger.completeContentIdempotency,
      release: ledger.releaseContentIdempotency,
    },
    generateExport: deps.generateExport ?? exports.generateDocumentExport,
    getFolderCoverImage: deps.getFolderCoverImage ?? images.getImageInScope,
    signFolderCoverUrl: deps.signFolderCoverUrl ?? imageUrl.signedImageUrl,
    signDocumentSourceUrl: deps.signDocumentSourceUrl ?? imageUrl.signedImageUrl,
    signAudioUrl: deps.signAudioUrl ?? audioUrl.signedAudioUrl,
  };
}

function principal(context: ToolContext, tool: ContentToolName) {
  if (context.principal.kind !== 'member') fail('CONTENT_UNAUTHORIZED', 'A resolved human principal is required.', tool, 'authorization');
  const member = context.principal;
  if (member.userOrganization.organizationId !== context.organizationKey || member.userOrganization.status !== 'active') fail('CONTENT_FORBIDDEN', 'Active membership in the requested organization is required.', tool, 'authorization');
  return member;
}

async function observe(deps: ContentToolDependencies, event: SafeEvent) { try { await deps.observer?.(event); } catch { /* Telemetry cannot alter behavior. */ } }

async function batch<T>(tool: ContentToolName, items: Array<{ key: string; run: (repository: ContentRepository, transactionBound: boolean) => Promise<T>; preflight?: () => Promise<void>; transactional?: boolean }>, atomic: boolean, initialRepository: ContentRepository) {
  let repo = initialRepository;
  if (atomic && !repo.transaction) fail('CONTENT_CONFLICT', 'Atomic mode is unavailable for this operation.', tool, 'transaction');
  if (atomic) for (const item of items) await item.preflight?.();
  const execute = async () => {
    const results: unknown[] = [];
    for (const item of items) {
      try {
        if (!atomic) await item.preflight?.();
        if (!atomic && item.transactional && !initialRepository.transaction) fail('CONTENT_CONFLICT', 'Transaction-bound item execution is unavailable.', tool, 'transaction', item.key);
        const data = !atomic && item.transactional
          ? await initialRepository.transaction!((transactionRepository) => item.run(transactionRepository, true))
          : await item.run(repo, atomic);
        results.push({ key: item.key, success: true, data });
      }
      catch (error) {
        const mapped = mappedError(error, tool, undefined, item.key);
        if (atomic) throw mapped;
        results.push({ key: item.key, success: false, error: mapped.toJSON() });
      }
    }
    const succeeded = results.filter((item: any) => item.success).length;
    return { results, summary: { requested: results.length, succeeded, failed: results.length - succeeded } };
  };
  if (!atomic) return execute();
  return initialRepository.transaction!(async (transactionRepository) => {
    repo = transactionRepository;
    return execute();
  });
}

async function fingerprintInput(input: unknown): Promise<string> {
  const normalize = async (value: unknown): Promise<unknown> => {
    if (value instanceof Uint8Array) return { byteLength: value.byteLength, sha256: createHash('sha256').update(value).digest('hex') };
    if (Array.isArray(value)) return Promise.all(value.map(normalize));
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown> & { arrayBuffer?: () => Promise<ArrayBuffer> };
      if (typeof record.arrayBuffer === 'function') {
        const bytes = new Uint8Array(await record.arrayBuffer());
        return {
          name: record.name,
          type: record.type,
          size: record.size,
          byteLength: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
      }
      const entries = await Promise.all(Object.entries(record)
        .filter(([key]) => key !== 'idempotencyKey')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(async ([key, item]) => [key, await normalize(item)] as const));
      return Object.fromEntries(entries);
    }
    return value;
  };
  return createHash('sha256').update(JSON.stringify(await normalize(input))).digest('hex');
}

export function isContentMutation(tool: ContentToolName, input: any): boolean {
  if (tool === 'document.summarize') return input.persist === true;
  if (tool === 'document.enhance') return input.mode !== 'preview';
  if (tool === 'document.translate') return input.mode !== 'preview';
  if (tool === 'document.rewrite') return Array.isArray(input?.rewrites) && input.rewrites.some((item: any) => item?.mode !== 'preview');
  return MUTATIONS.has(tool);
}

async function hashPassword(password: string, random: (size: number) => Uint8Array) { const salt = Buffer.from(random(16)); const hash = await scrypt(password, salt, 32) as Buffer; return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`; }

export async function runContentTool<Name extends ContentToolName>(name: Name, rawInput: unknown, context: ToolContext, dependencies: ContentToolDependencies = {}): Promise<ContentToolOutput<Name>> {
  if (!isContentToolName(name)) throw new ContentError('CONTENT_INVALID_INPUT', 'Unknown Content tool.', String(name), { action: 'parse' });
  const tool = name; const member = principal(context, tool); let input: any;
  try { input = contentToolInputSchemas[tool].parse(rawInput); } catch (error) { throw mappedError(error, tool, 'parse'); }
  const d = await defaults(dependencies, context);
  const invocationKey = d.id();
  const invocationStarted = performance.now();
  const now = () => d.clock().toISOString();
  const nextUpdatedAt = (current: string) => new Date(Math.max(d.clock().getTime(), Date.parse(current) + 1)).toISOString();
  const event = (type: SafeEvent['type'], status: SafeEvent['status'], action?: string, resourceKey?: string, scopeKey?: string, durationMs?: number) => observe(dependencies, { type, status, tool, invocationKey, action, resourceKey, scopeKey, durationMs });
  await event('action', 'started', 'tool', undefined, context.runtimeScopeKey);
  const observeRepository = (target: ContentRepository): ContentRepository => new Proxy(target, {
    get(repository, property, receiver) {
      const value = Reflect.get(repository, property, receiver);
      if (property === 'transaction' && typeof value === 'function') {
        return (operation: (bound: ContentRepository) => Promise<unknown>) => value.call(repository, (bound: ContentRepository) => operation(observeRepository(bound)));
      }
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        const method = String(property);
        const primitive = method.startsWith('get') ? 'read' : method.startsWith('list') || method === 'allowedScopeKeys' || method === 'semanticSearch' ? 'traverse' : method.startsWith('insert') || method.startsWith('create') ? 'insert' : method.startsWith('update') ? 'update' : method.startsWith('delete') ? 'delete' : 'read';
        const resourceKey = typeof args[0] === 'string' ? args[0] : undefined;
        const started = performance.now();
        await event('db', 'started', primitive, resourceKey);
        try {
          const output = await value.apply(repository, args);
          await event('db', 'succeeded', primitive, resourceKey, undefined, Math.round(performance.now() - started));
          return output;
        } catch (error) {
          await event('db', 'failed', primitive, resourceKey, undefined, Math.round(performance.now() - started));
          throw error;
        }
      };
    },
  });
  const repo = observeRepository(d.repository);
  const action = async (slug: ActionId, actionInput: Record<string, unknown>, resourceKey?: string, scopeKey?: string) => {
    const started = performance.now();
    await event('action', 'started', slug, resourceKey, scopeKey);
    try {
      const output = await d.runAction(slug, actionInput, context);
      await event('action', 'succeeded', slug, resourceKey, scopeKey, Math.round(performance.now() - started));
      return output;
    } catch (error) {
      await event('action', 'failed', slug, resourceKey, scopeKey, Math.round(performance.now() - started));
      throw error;
    }
  };
  const embed = async (text: string, resourceKey?: string, scopeKey?: string, purpose: 'document' | 'query' = 'document') => {
    const started = performance.now();
    await event('embedding', 'started', 'embed', resourceKey, scopeKey);
    try {
      const embedding = z.array(z.number().finite()).min(1).parse(await d.embed(text, purpose));
      await event('embedding', 'succeeded', 'embed', resourceKey, scopeKey, Math.round(performance.now() - started));
      return embedding;
    } catch (error) {
      await event('embedding', 'failed', 'embed', resourceKey, scopeKey, Math.round(performance.now() - started));
      throw error;
    }
  };
  const storageOperation = async <T>(slug: string, resourceKey: string | undefined, scopeKey: string | undefined, operation: () => Promise<T>) => {
    const started = performance.now();
    await event('storage', 'started', slug, resourceKey, scopeKey);
    try {
      const output = await operation();
      await event('storage', 'succeeded', slug, resourceKey, scopeKey, Math.round(performance.now() - started));
      return output;
    } catch (error) {
      await event('storage', 'failed', slug, resourceKey, scopeKey, Math.round(performance.now() - started));
      throw error;
    }
  };
  const deleteStorageKeys = async (keys: Array<string | undefined>, resourceKey: string, scopeKey: string) => {
    for (const storageKey of new Set(keys.filter((key): key is string => typeof key === 'string' && key.length > 0))) {
      try { await storageOperation('delete', resourceKey, scopeKey, () => d.storage.delete(storageKey)); }
      catch (error) { throw new ContentError('CONTENT_CONFLICT', 'Storage deletion failed; metadata pointers were retained for retry.', tool, { action: 'storage', resourceKey, cause: error, retryable: true }); }
    }
  };
  const roleFor = async (scopeKey: string, minimum: Role, resourceKey?: string, repository = repo) => {
    const started = performance.now();
    await event('authorization', 'started', minimum, resourceKey, scopeKey);
    try {
      const scope = await repository.getScope(scopeKey);
      if (!scope || scope.organizationKey !== context.organizationKey) fail('CONTENT_NOT_FOUND', 'Scope was not found in this organization.', tool, 'resolution', resourceKey);
      const role: Role | null = member.userOrganization.orgRole === 'owner' || member.userOrganization.orgRole === 'admin' ? member.userOrganization.orgRole : await repository.role(scopeKey, member.userOrganization.key);
      if (!role || rank[role] < rank[minimum]) fail('CONTENT_FORBIDDEN', 'The principal lacks the required scope role.', tool, 'authorization', resourceKey);
      await event('authorization', 'succeeded', minimum, resourceKey, scopeKey, Math.round(performance.now() - started));
      return role;
    } catch (error) {
      await event('authorization', 'failed', minimum, resourceKey, scopeKey, Math.round(performance.now() - started));
      throw error;
    }
  };
  const folder = async (key: string, minimum: Role = 'viewer', pendingDeletion = false, repository = repo) => {
    const value = await repository.getFolder(key);
    if (!value) fail('CONTENT_NOT_FOUND', 'Folder was not found.', tool, 'read', key);
    await roleFor(value.scopeKey, minimum, key, repository);
    if (!pendingDeletion && value._internalDeletion) fail('CONTENT_NOT_FOUND', 'Folder was not found.', tool, 'read', key);
    return value;
  };
  const folderAncestors = async (parentKey: string | undefined, scopeKey: string, minimum: Role, repository = repo): Promise<Folder[]> => {
    const ancestors: Folder[] = [];
    const visited = new Set<string>();
    let currentKey = parentKey;
    while (currentKey) {
      if (visited.has(currentKey)) fail('FOLDER_CYCLE_DETECTED', 'The folder hierarchy contains a cycle.', tool, 'resolution', currentKey);
      visited.add(currentKey);
      const current = await repository.getFolder(currentKey);
      if (!current || current.scopeKey !== scopeKey) fail('CONTENT_CONFLICT', 'Folder ancestor left the requested scope.', tool, 'resolution', currentKey);
      if (current._internalDeletion) fail('CONTENT_NOT_FOUND', 'Folder was not found.', tool, 'read', currentKey);
      await roleFor(current.scopeKey, minimum, current.key, repository);
      ancestors.push(current);
      currentKey = current.parentFolderKey;
    }
    return ancestors;
  };
  const document = async (key: string, minimum: Role = 'viewer', pendingDeletion = false, repository = repo) => {
    const value = await repository.getDocument(key);
    if (!value) fail('CONTENT_NOT_FOUND', 'Document was not found.', tool, 'read', key);
    await roleFor(value.scopeKey, minimum, key, repository);
    if (!pendingDeletion && value._internalDeletion) fail('CONTENT_NOT_FOUND', 'Document was not found.', tool, 'read', key);
    let parentKey: string | undefined = value.folderKey;
    const visited = new Set<string>();
    while (parentKey) {
      if (visited.has(parentKey)) fail('FOLDER_CYCLE_DETECTED', 'The document folder hierarchy contains a cycle.', tool, 'resolution', parentKey);
      visited.add(parentKey);
      const parent = await repository.getFolder(parentKey);
      if (!parent || parent.scopeKey !== value.scopeKey) fail('CONTENT_CONFLICT', 'Document folder resolution failed.', tool, 'resolution', key);
      if (!pendingDeletion && parent._internalDeletion) fail('CONTENT_NOT_FOUND', 'Document was not found.', tool, 'read', key);
      parentKey = parent.parentFolderKey;
    }
    return value;
  };
  const foldersIn = async (scopeKey: string, includePendingDeletion = false) => (await repo.listFolders(scopeKey, includePendingDeletion))
    .filter((item) => includePendingDeletion || !item._internalDeletion);
  const descendants = (all: Folder[], key: string) => { const out: Folder[] = []; const pending = [key]; const seen = new Set(pending); while (pending.length) { const parentKey = pending.shift()!; for (const child of all.filter((f) => f.parentFolderKey === parentKey)) if (!seen.has(child.key)) { seen.add(child.key); out.push(child); pending.push(child.key); } } return out; };
  const activeFolderHierarchy = async (key: string | undefined, scopeKey: string) => {
    let currentKey: string | undefined = key;
    const visited = new Set<string>();
    while (currentKey) {
      if (visited.has(currentKey)) return false;
      visited.add(currentKey);
      const current = await repo.getFolder(currentKey);
      if (!current || current.scopeKey !== scopeKey || current._internalDeletion) return false;
      currentKey = current.parentFolderKey;
    }
    return true;
  };
  const location = async (scopeKey: string, folderKey: string | undefined, minimum: Role) => {
    await roleFor(scopeKey, minimum, folderKey);
    if (!folderKey) return undefined;
    const target = await folder(folderKey, minimum);
    if (target.scopeKey !== scopeKey) fail('CONTENT_FORBIDDEN', 'Folder does not belong to the requested scope.', tool, 'authorization', folderKey);
    return target;
  };
  const generated = async (doc: Document, instruction: string, deep = false) => {
    const slug = deep ? 'deep-reason' : 'reason';
    const output = await action(slug, {
      systemPrompt: `${instruction} Use only the supplied document. Preserve its facts and return only the requested text without commentary.`,
      messages: [{ role: 'user', content: [{ type: 'text', text: `Title: ${doc.name}\n\n${doc.content}` }] }],
      options: { temperature: 0.2, maxTokens: Math.min(5_000, Math.max(256, Math.ceil(doc.content.length / 3))) },
    }, doc.key, doc.scopeKey);
    if (!output.text?.trim()) fail('CONTENT_CONFLICT', 'The generation action returned invalid output.', tool, slug, doc.key);
    return output.text.trim();
  };
  const parsedSemantics = (embedded: ContentActionResult, content: string, resourceKey: string) => {
    const embedding = z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS).parse(embedded.embedding);
    const contentChunks = embedded.contentChunks
      ? z.array(z.string().trim().min(1)).min(1).parse(embedded.contentChunks)
      : chunkDocumentContent(content);
    const chunkEmbeddings = embedded.chunkEmbeddings
      ? z.array(z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS)).length(contentChunks.length).parse(embedded.chunkEmbeddings)
      : contentChunks.length === 1 ? [embedding] : fail('CONTENT_CONFLICT', 'Document embedding action did not return every semantic chunk.', tool, 'document-embed', resourceKey);
    return {
      embedding,
      contentChunks,
      chunkEmbeddings,
      semanticChunkCount: z.number().int().positive().parse(embedded.semanticChunkCount ?? contentChunks.length),
      semanticContentHash: z.string().regex(/^[a-f0-9]{64}$/).parse(embedded.semanticContentHash ?? createHash('sha256').update(content).digest('hex')),
    };
  };
  const representations = async (
    source: string,
    documentName: string,
    resourceKey: string,
    scopeKey: string,
  ) => {
    const content = sanitizeDocumentContent(z.string().min(1).parse(source));
    if (!content) fail('CONTENT_CONFLICT', 'Document content is empty.', tool, 'document-embed', resourceKey);
    const embedded = await action('document-embed', { name: documentName, content }, resourceKey, scopeKey);
    return { content, ...parsedSemantics(embedded, content, resourceKey) };
  };
  const isCurrentEmbedding = (embedding: readonly number[]) => embedding.length === EMBEDDING_DIMENSIONS && embedding.every(Number.isFinite);
  const hasCurrentSemantics = (source: Pick<Document, 'embedding' | 'content' | 'contentChunks' | 'chunkEmbeddings'>) => {
    const expectedChunks = chunkDocumentContent(source.content);
    return isCurrentEmbedding(source.embedding)
      && source.contentChunks?.length === expectedChunks.length
      && source.contentChunks.every((chunk, index) => chunk === expectedChunks[index])
      && source.chunkEmbeddings?.length === expectedChunks.length
      && source.chunkEmbeddings.every(isCurrentEmbedding);
  };
  const generatedSemantics = async (name: string, content: string, resourceKey: string, scopeKey: string) => {
    const embedded = await action('document-embed', { name, content }, resourceKey, scopeKey);
    return parsedSemantics(embedded, content, resourceKey);
  };
  const currentDocumentSemantics = (source: Pick<Document, 'embedding' | 'name' | 'content' | 'contentChunks' | 'chunkEmbeddings' | 'key' | 'scopeKey'>, name = source.name) =>
    name === source.name && hasCurrentSemantics(source)
      ? Promise.resolve({ embedding: source.embedding, contentChunks: source.contentChunks!, chunkEmbeddings: source.chunkEmbeddings!, semanticChunkCount: source.contentChunks!.length, semanticContentHash: createHash('sha256').update(source.content).digest('hex') })
      : generatedSemantics(name, source.content, source.key, source.scopeKey);
  const currentVersionSemantics = async (source: Pick<DocumentVersion, 'content' | 'key' | 'scopeKey'> | Pick<Document, 'content' | 'key' | 'scopeKey'>, documentName: string) => {
    const { embedding, chunkEmbeddings, semanticChunkCount, semanticContentHash } = await generatedSemantics(documentName, source.content, source.key, source.scopeKey);
    return { embedding, chunkEmbeddings, semanticChunkCount, semanticContentHash };
  };
  // Version snapshots already carry aligned semantics, so restoring one should not repeat a model call.
  const restoredVersionSemantics = (version: DocumentVersion, documentName: string) => {
    const contentChunks = chunkDocumentContent(version.content);
    if (!isCurrentEmbedding(version.embedding)
      || version.chunkEmbeddings?.length !== contentChunks.length
      || !version.chunkEmbeddings.every(isCurrentEmbedding)) {
      return generatedSemantics(documentName, version.content, version.key, version.scopeKey);
    }
    return Promise.resolve({
      embedding: version.embedding,
      contentChunks,
      chunkEmbeddings: version.chunkEmbeddings,
      semanticChunkCount: contentChunks.length,
      semanticContentHash: createHash('sha256').update(version.content).digest('hex'),
    });
  };
  const persistGenerated = async (source: Document, text: string, mode: 'copy' | 'replace', suffix: string) => {
    const finalName = mode === 'copy' ? `${source.name} (${suffix})` : source.name;
    const transformed = await representations(text, finalName, source.key, source.scopeKey);
    if (mode === 'replace') {
      const backup = await repo.createVersion({
        scopeKey: source.scopeKey,
        documentKey: source.key,
        content: source.content,
        ...await currentVersionSemantics(source, source.name),
      });
      try {
        await repo.updateDocument(source.key, { ...transformed, currentVersionKey: null, updatedAt: now() });
      } catch (error) {
        try { await repo.deleteVersion(backup.key); }
        catch (cleanupError) { throw new ContentError('CONTENT_CONFLICT', 'AI replacement failed and backup compensation requires retry.', tool, { action: 'cleanup', resourceKey: source.key, cause: new AggregateError([error, cleanupError]), retryable: true }); }
        throw error;
      }
      return source.key;
    }
    const key = d.id();
    const timestamp = now();
    await repo.insertDocument({
      key,
      scopeKey: source.scopeKey,
      ...(source.folderKey ? { folderKey: source.folderKey } : {}),
      name: finalName,
      isFavorite: false,
      ...transformed,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return key;
  };
  const mutation = isContentMutation(tool, input);
  const idempotencyIdentity = mutation && input.idempotencyKey ? {
    organizationKey: context.organizationKey,
    actorKey: member.user.key,
    tool,
    idempotencyKey: input.idempotencyKey,
  } : undefined;
  const requestHash = idempotencyIdentity ? await fingerprintInput(input) : undefined;
  let ownsIdempotencyClaim = false;
  let executionCompleted = false;
  if (idempotencyIdentity && requestHash) {
    const claim = await d.idempotency.claim(idempotencyIdentity, requestHash, invocationKey, now());
    if (claim.status === 'replay') return contentToolOutputSchemas[tool].parse(claim.response) as ContentToolOutput<Name>;
    if (claim.status === 'conflict') fail('CONTENT_CONFLICT', 'Idempotency key was already used with a different request.', tool, 'idempotency');
    if (claim.status === 'pending') throw new ContentError('CONTENT_CONFLICT', 'An invocation with this idempotency key is still pending.', tool, { action: 'idempotency', retryable: true });
    ownsIdempotencyClaim = true;
  }
  let result: unknown;
  try {
    if (tool === 'folder.create') {
      const creates = input.folders.map((item: any) => ({ ...item, key: item.key ?? d.id() }));
      result = await batch(tool, creates.map((item: any) => ({
        key: item.key,
        run: async () => {
          await roleFor(item.scopeKey, 'moderator');
          if (item.parentFolderKey) {
            const parent = await folder(item.parentFolderKey, 'moderator', false);
            if (parent.scopeKey !== item.scopeKey) fail('FOLDER_MOVE_FORBIDDEN', 'Parent belongs to another scope.', tool, 'insert', item.parentFolderKey);
          }
          if (item.coverImageKey && !await d.getFolderCoverImage(item.scopeKey, item.coverImageKey)) fail('CONTENT_NOT_FOUND', 'Folder cover image was not found in this scope.', tool, 'read', item.coverImageKey);
          const embedding = await embed([item.name, item.description].filter(Boolean).join('\n\n'), item.key, item.scopeKey);
          const timestamp = now();
          const value = await repo.insertFolder({
            key: item.key,
            scopeKey: item.scopeKey,
            ...(item.parentFolderKey ? { parentFolderKey: item.parentFolderKey } : {}),
            name: item.name,
            ...(item.description ? { description: item.description } : {}),
            ...(item.coverImageKey ? { coverImageKey: item.coverImageKey } : {}),
            embedding,
            isFavorite: false,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          return { folder: await folderView(value, d) };
        },
      })), false, repo);
    } else if (tool === 'folder.find') {
      result = await batch(tool, input.folderKeys.map((key: string) => ({
        key,
        run: async () => {
          const current = await folder(key);
          const allFolders = await foldersIn(current.scopeKey);
          const allDocuments = await repo.listDocuments(current.scopeKey, true);
          return {
            folder: {
              ...await folderView(current, d),
              ...(input.includeChildrenCount ? { childrenCount: allFolders.filter((item) => item.parentFolderKey === key).length } : {}),
              ...(input.includeDocumentCount ? { documentCount: allDocuments.filter((item) => item.folderKey === key).length } : {}),
            },
          };
        },
      })), false, repo);
    } else if (tool === 'folder.list') {
      await roleFor(input.scopeKey, 'viewer');
      if (input.parentFolderKey) {
        const parent = await folder(input.parentFolderKey, 'viewer');
        if (parent.scopeKey !== input.scopeKey) fail('CONTENT_NOT_FOUND', 'Folder was not found in this scope.', tool, 'read', input.parentFolderKey);
      }
      const allFolders = await foldersIn(input.scopeKey);
      const folderByKey = new Map(allFolders.map((item) => [item.key, item]));
      const isVisible = (item: Folder) => {
        let current: Folder | undefined = item;
        const visited = new Set<string>();
        while (current) {
          if (visited.has(current.key)) return false;
          visited.add(current.key);
          if (current.parentFolderKey && !folderByKey.has(current.parentFolderKey)) return false;
          current = current.parentFolderKey ? folderByKey.get(current.parentFolderKey) : undefined;
        }
        return true;
      };
      const values = allFolders.filter((item) => {
        if (!isVisible(item)) return false;
        if (!input.includeDescendants) return item.parentFolderKey === input.parentFolderKey;
        if (!input.parentFolderKey) return true;
        let parentKey = item.parentFolderKey;
        const visited = new Set<string>();
        while (parentKey && !visited.has(parentKey)) {
          if (parentKey === input.parentFolderKey) return true;
          visited.add(parentKey);
          parentKey = folderByKey.get(parentKey)?.parentFolderKey;
        }
        return false;
      });
      const sort = input.sort ?? { field: 'name', direction: 'asc' };
      values.sort((left: any, right: any) => String(left[sort.field]).localeCompare(String(right[sort.field])) * (sort.direction === 'asc' ? 1 : -1));
      const offset = input.cursor ? Number(Buffer.from(input.cursor, 'base64url').toString()) || 0 : 0;
      const limit = input.limit ?? 50;
      const documents = input.includeDocuments && input.parentFolderKey
        ? (await repo.listDocuments(input.scopeKey)).filter((item) => item.folderKey === input.parentFolderKey).map(documentView)
        : undefined;
      result = {
        folders: await Promise.all(values.slice(offset, offset + limit).map((value) => folderView(value, d))),
        ...(documents ? { documents } : {}),
        ...(offset + limit < values.length ? { cursor: Buffer.from(String(offset + limit)).toString('base64url') } : {}),
      };
    } else if (['folder.update', 'folder.rename'].includes(tool)) {
      const items = tool === 'folder.update' ? input.updates : input.renames;
      const requiresEmbedding = tool === 'folder.rename' || items.some((item: any) => item.name !== undefined || item.description !== undefined);
      if (input.atomic && requiresEmbedding) fail('CONTENT_CONFLICT', 'Atomic folder metadata updates are unavailable because embedding is an external side effect.', tool, 'embed');
      result = await batch(tool, items.map((item: any) => ({
        key: item.folderKey,
        preflight: async () => { await folder(item.folderKey, 'moderator', false); },
        run: async (mutationRepository: ContentRepository) => {
          const current = await folder(item.folderKey, 'moderator', false);
          if (item.coverImageKey && !await d.getFolderCoverImage(current.scopeKey, item.coverImageKey)) fail('CONTENT_NOT_FOUND', 'Folder cover image was not found in this scope.', tool, 'read', item.coverImageKey);
          const changesEmbedding = item.name !== undefined || item.description !== undefined;
          const name = item.name ?? current.name;
          const description = item.description === null ? undefined : item.description ?? current.description;
          const embedding = changesEmbedding ? await embed([name, description].filter(Boolean).join('\n\n'), current.key, current.scopeKey) : undefined;
          const patch = {
            ...(item.name !== undefined ? { name: item.name } : {}),
            ...(item.description !== undefined ? { description: item.description ?? undefined } : {}),
            ...(item.coverImageKey !== undefined ? { coverImageKey: item.coverImageKey ?? undefined } : {}),
            ...(item.isFavorite !== undefined ? { isFavorite: item.isFavorite } : {}),
            ...(embedding ? { embedding } : {}),
            updatedAt: now(),
          };
          return { folder: await folderView(await mutationRepository.updateFolder(current.key, patch), d) };
        },
      })), input.atomic, repo);
    } else if (tool === 'folder.move') {
      result = await batch(tool, input.moves.map((item: any) => ({
        key: item.folderKey,
        preflight: async () => {
          const source = await folder(item.folderKey, 'admin', false);
          if (!item.targetParentFolderKey) return;
          const target = await folder(item.targetParentFolderKey, 'admin', false);
          if (source.scopeKey !== target.scopeKey) fail('FOLDER_MOVE_FORBIDDEN', 'Cross-scope folder moves are forbidden.', tool, 'update', source.key);
          const all = await foldersIn(source.scopeKey);
          if (target.key === source.key || descendants(all, source.key).some((child) => child.key === target.key)) fail('FOLDER_CYCLE_DETECTED', 'Folder move would create a cycle.', tool, 'update', source.key);
        },
        run: async (mutationRepository: ContentRepository) => {
          const source = await folder(item.folderKey, 'admin', false);
          const moved = await mutationRepository.updateFolder(source.key, {
            parentFolderKey: item.targetParentFolderKey,
            updatedAt: now(),
          });
          return { folder: await folderView(moved, d) };
        },
      })), input.atomic, repo);
    } else if (tool === 'folder.copy') {
      if (input.atomic) fail('CONTENT_CONFLICT', 'Atomic folder copy is unavailable because storage copy cannot be rolled back transactionally.', tool, 'storage');
      result = await batch(tool, input.copies.map((item: any) => ({
        key: item.folderKey,
        run: async () => {
          const source = await folder(item.folderKey, 'viewer', false);
          const target = await location(item.targetScopeKey, item.targetParentFolderKey, 'moderator');
          const sourceScopeFolders = await foldersIn(source.scopeKey);
          const sourceFolders = [source, ...descendants(sourceScopeFolders, source.key)];
          const rootName = item.newName ?? source.name;
          const sourceFolderKeys = new Set(sourceFolders.map((candidate) => candidate.key));
          const sourceDocuments = (await repo.listDocuments(source.scopeKey)).filter((candidate) => candidate.folderKey && sourceFolderKeys.has(candidate.folderKey));
          const folderKeys = new Map(sourceFolders.map((candidate) => [candidate.key, d.id()]));
          const insertedFolderKeys: string[] = [];
          const insertedDocumentKeys: string[] = [];
          const copiedStorageKeys: string[] = [];
          const documentStorageKeys = new Map<string, string[]>();
          const timestamp = now();
          const copyObject = async (sourceKey: string, destinationKey: string, mimeType?: string) => {
            const copied = await storageOperation('copy', source.key, item.targetScopeKey, () => d.storage.copy({ sourceKey, destinationKey, mimeType }));
            copiedStorageKeys.push(copied.storageKey);
            return copied.storageKey;
          };
          try {
            for (const current of sourceFolders) {
              const key = folderKeys.get(current.key)!;
              const parentFolderKey = current.key === source.key ? target?.key : folderKeys.get(current.parentFolderKey!);
              const name = current.key === source.key ? rootName : current.name;
              const embedding = current.key === source.key && name !== current.name
                ? await embed([name, current.description].filter(Boolean).join('\n\n'), key, item.targetScopeKey)
                : current.embedding;
              const created = await repo.insertFolder({
                ...current,
                key,
                scopeKey: item.targetScopeKey,
                ...(parentFolderKey ? { parentFolderKey } : { parentFolderKey: undefined }),
                name,
                embedding,
                ...(source.scopeKey === item.targetScopeKey ? {} : { coverImageKey: undefined }),
                isFavorite: false,
                _internalDeletion: undefined,
                createdAt: timestamp,
                updatedAt: timestamp,
              });
              insertedFolderKeys.push(created.key);
            }
            for (const current of sourceDocuments) {
              const key = d.id();
              const base = `content/${context.organizationKey}/${item.targetScopeKey}/${key}`;
              const storageKey = current.storageKey && current.extension
                ? await copyObject(current.storageKey, `${base}/original.${current.extension}`, current.mimeType)
                : undefined;
              const sourceStorageKeys: string[] = [];
              for (let index = 0; index < (current.sourceStorageKeys?.length ?? 0); index += 1) {
                const sourceKey = current.sourceStorageKeys![index]!;
                const suffix = sourceKey.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
                sourceStorageKeys.push(await copyObject(sourceKey, `${base}/sources/${index + 1}${suffix}`));
              }
              const speechStorageKeys: string[] = [];
              for (let index = 0; index < (current.speechStorageKeys?.length ?? 0); index += 1) {
                const sourceKey = current.speechStorageKeys![index]!;
                const suffix = sourceKey.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
                speechStorageKeys.push(await copyObject(sourceKey, `${base}/speech/${index + 1}${suffix}`));
              }
              const created = await repo.insertDocument({
                ...current,
                key,
                scopeKey: item.targetScopeKey,
                folderKey: folderKeys.get(current.folderKey!)!,
                ...(storageKey ? { storageKey } : { storageKey: undefined }),
                ...(sourceStorageKeys.length ? { sourceStorageKeys } : { sourceStorageKeys: undefined }),
                ...(speechStorageKeys.length ? { speechStorageKeys } : { speechStorageKeys: undefined }),
                isFavorite: false,
                _internalDeletion: undefined,
                createdAt: timestamp,
                updatedAt: timestamp,
              });
              insertedDocumentKeys.push(created.key);
              documentStorageKeys.set(created.key, [storageKey, ...sourceStorageKeys, ...speechStorageKeys].filter((value): value is string => Boolean(value)));
            }
            const copiedRoot = await repo.getFolder(folderKeys.get(source.key)!);
            if (!copiedRoot) fail('CONTENT_CONFLICT', 'Copied folder root could not be read.', tool, 'read', source.key);
            return { folder: await folderView(copiedRoot, d), folderCount: sourceFolders.length, documentCount: sourceDocuments.length };
          } catch (error) {
            console.error('folder copy failed before compensation', { sourceFolderKey: source.key, targetScopeKey: item.targetScopeKey, targetParentFolderKey: item.targetParentFolderKey, error });
            const cleanupErrors: unknown[] = [];
            const folderMarker = { kind: 'folder' as const, owner: invocationKey, startedAt: timestamp, folderKeys: insertedFolderKeys, documentKeys: insertedDocumentKeys, objectKeys: copiedStorageKeys };
            try {
              if (!repo.transaction) throw new Error('Transaction-bound copy compensation is unavailable.');
              await repo.transaction(async (bound) => {
                for (const key of insertedDocumentKeys) {
                  const marker = { kind: 'document' as const, owner: invocationKey, startedAt: timestamp, objectKeys: documentStorageKeys.get(key) ?? [] };
                  if (!await bound.setDocumentDeletion(key, marker)) throw new Error(`Copied document ${key} could not be frozen for compensation.`);
                }
                for (const key of [...insertedFolderKeys].reverse()) if (!await bound.setFolderDeletion(key, folderMarker)) throw new Error(`Copied folder ${key} could not be frozen for compensation.`);
              });
            } catch (cleanupError) {
              cleanupErrors.push(cleanupError);
            }
            if (cleanupErrors.length === 0) {
              const failedDocumentKeys = new Set<string>();
              for (const key of [...insertedDocumentKeys].reverse()) await repo.deleteDocument(key).catch((cleanupError) => { failedDocumentKeys.add(key); cleanupErrors.push(cleanupError); });
              const retainedStorageKeys = new Set([...failedDocumentKeys].flatMap((key) => documentStorageKeys.get(key) ?? []));
              const failedStorageKeys = new Set(retainedStorageKeys);
              for (const key of [...copiedStorageKeys].reverse()) if (!retainedStorageKeys.has(key)) {
                await storageOperation('delete', source.key, item.targetScopeKey, () => d.storage.delete(key)).catch((cleanupError) => { failedStorageKeys.add(key); cleanupErrors.push(cleanupError); });
              }
              // Folder markers retain the manifest until every document pointer and object is gone.
              const remainingFolderKeys = new Set(insertedFolderKeys);
              if (cleanupErrors.length === 0) for (const key of [...insertedFolderKeys].reverse()) {
                await repo.deleteFolder(key).then(() => remainingFolderKeys.delete(key)).catch((cleanupError) => cleanupErrors.push(cleanupError));
              }
              if (cleanupErrors.length > 0 && remainingFolderKeys.size > 0) {
                const recoveryMarker = { ...folderMarker, folderKeys: [...remainingFolderKeys], documentKeys: [...failedDocumentKeys], objectKeys: [...failedStorageKeys] };
                try {
                  await repo.transaction!(async (bound) => {
                    for (const key of remainingFolderKeys) if (!await bound.setFolderDeletion(key, recoveryMarker, invocationKey)) throw new Error(`Copied folder ${key} compensation manifest could not be updated.`);
                  });
                } catch (cleanupError) {
                  cleanupErrors.push(cleanupError);
                }
              }
            }
            if (cleanupErrors.length) throw new ContentError('CONTENT_CONFLICT', 'Folder copy failed and compensation requires retry.', tool, { action: 'cleanup', resourceKey: insertedFolderKeys[0] ?? source.key, cause: new AggregateError([error, ...cleanupErrors]), retryable: true });
            throw error;
          }
        },
      })), false, repo);
    } else if (tool === 'folder.delete') {
      result = await batch(tool, input.folderKeys.map((key: string) => ({
        key,
        preflight: async () => {
          const root = await folder(key, 'owner', true);
          if (root._internalDeletion) {
            const manifest = root._internalDeletion;
            if (input.atomic) fail('CONTENT_CONFLICT', 'Atomic folder deletion cannot resume an existing deletion manifest.', tool, 'transaction', key);
            if (manifest.kind !== 'folder' || !manifest.folderKeys || !manifest.documentKeys || !manifest.folderKeys.includes(key)) fail('CONTENT_CONFLICT', 'Folder deletion manifest is incomplete.', tool, 'delete', key);
            return;
          }
          if (root.isFavorite) fail('CONTENT_CONFLICT', 'Unfavorite the folder before deleting it.', tool, 'delete', key);
        },
        run: async (mutationRepository: ContentRepository) => {
          if (input.atomic) {
            const candidate = await mutationRepository.getFolder(key);
            if (!candidate) fail('CONTENT_NOT_FOUND', 'Folder was not found.', tool, 'read', key);
            const all = await mutationRepository.listFolders(candidate.scopeKey, true);
            const children = descendants(all, key);
            const affected = input.recursive ? [candidate, ...children] : [candidate];
            const affectedKeys = new Set(affected.map((item) => item.key));
            const documents = (await mutationRepository.listDocuments(candidate.scopeKey, true)).filter((item) => item.folderKey !== undefined && affectedKeys.has(item.folderKey));
            if (!input.recursive && children.length > 0) fail('FOLDER_NOT_EMPTY', 'Folder is not empty.', tool, 'delete', key);
            if (documents.length > 0) fail('CONTENT_CONFLICT', 'Atomic folder deletion is unavailable when storage objects are involved.', tool, 'storage', key);
            for (const item of affected) {
              if (item._internalDeletion) fail('CONTENT_CONFLICT', 'A folder deletion is already pending.', tool, 'delete', item.key);
              if (item.isFavorite) fail('CONTENT_CONFLICT', 'Unfavorite every recursively deleted folder before deleting it.', tool, 'delete', item.key);
            }
            if (documents.some((item) => item.isFavorite)) fail('CONTENT_CONFLICT', 'Unfavorite every document in the folder before deleting it.', tool, 'delete', key);
            const marker = { kind: 'folder' as const, owner: invocationKey, startedAt: now(), folderKeys: affected.map((item) => item.key), documentKeys: [], objectKeys: [] };
            for (const item of [...affected].reverse()) if (!await mutationRepository.setFolderDeletion(item.key, marker)) fail('CONTENT_CONFLICT', 'Folder could not be frozen for deletion.', tool, 'transaction', item.key);
            for (const item of [...affected].reverse()) await mutationRepository.deleteFolder(item.key);
            return {};
          }
          if (!repo.transaction) fail('CONTENT_CONFLICT', 'Transaction-bound deletion marking is unavailable.', tool, 'transaction', key);
          let ownsFreeze = false;
          let storageStarted = false;
          let root: Folder;
          let affected: Folder[] = [];
          let documents: Document[] = [];
          try {
            ({ root, affected, documents } = await repo.transaction(async (bound) => {
              const candidate = await bound.getFolder(key);
              if (!candidate) fail('CONTENT_NOT_FOUND', 'Folder was not found.', tool, 'read', key);
              if (candidate._internalDeletion) {
                if (candidate._internalDeletion.kind !== 'folder') fail('CONTENT_CONFLICT', 'A different deletion is already pending.', tool, 'delete', key);
                if (!candidate._internalDeletion.folderKeys || !candidate._internalDeletion.documentKeys) fail('CONTENT_CONFLICT', 'Folder deletion manifest is incomplete.', tool, 'delete', key);
                const all = await bound.listFolders(candidate.scopeKey, true);
                const intendedFolderKeys = candidate._internalDeletion.folderKeys;
                const frozen = all.filter((item) => intendedFolderKeys.includes(item.key));
                if (frozen.length !== intendedFolderKeys.length || frozen.some((item) => item._internalDeletion?.kind !== 'folder' || item._internalDeletion.owner !== candidate._internalDeletion!.owner)) {
                  fail('CONTENT_CONFLICT', 'Folder deletion manifest ownership changed.', tool, 'delete', key);
                }
                const frozenKeys = new Set(frozen.map((item) => item.key));
                const intendedDocumentKeys = candidate._internalDeletion.documentKeys;
                const frozenDocuments = (await bound.listDocuments(candidate.scopeKey, true)).filter((item) => intendedDocumentKeys.includes(item.key));
                if (frozenDocuments.length !== intendedDocumentKeys.length || frozenDocuments.some((item) => item._internalDeletion?.kind !== 'document' || item._internalDeletion.owner !== candidate._internalDeletion!.owner || item.folderKey === undefined || !frozenKeys.has(item.folderKey))) {
                  fail('CONTENT_CONFLICT', 'Document deletion manifest ownership changed.', tool, 'delete', key);
                }
                return { root: candidate, affected: frozen, documents: frozenDocuments };
              }
              const all = await bound.listFolders(candidate.scopeKey, true);
              const children = descendants(all, key);
              const frozen = input.recursive ? [candidate, ...children] : [candidate];
              const frozenKeys = new Set(frozen.map((item) => item.key));
              const ownedDocuments = (await bound.listDocuments(candidate.scopeKey, true)).filter((item) => item.folderKey !== undefined && frozenKeys.has(item.folderKey));
              if (!input.recursive && (children.length > 0 || ownedDocuments.length > 0)) fail('FOLDER_NOT_EMPTY', 'Folder is not empty.', tool, 'delete', key);
              if (ownedDocuments.length > 0 && input.atomic) fail('CONTENT_CONFLICT', 'Atomic folder deletion is unavailable when storage objects are involved.', tool, 'storage', key);
              for (const item of frozen) {
                if (item._internalDeletion) fail('CONTENT_CONFLICT', 'A descendant folder deletion is already pending.', tool, 'delete', item.key);
                if (item.isFavorite) fail('CONTENT_CONFLICT', 'Unfavorite every recursively deleted folder before deleting it.', tool, 'delete', item.key);
              }
              for (const item of ownedDocuments) {
                if (item._internalDeletion) fail('CONTENT_CONFLICT', 'A descendant document deletion is already pending.', tool, 'delete', item.key);
                if (item.isFavorite) fail('CONTENT_CONFLICT', 'Unfavorite every document in the folder before deleting it.', tool, 'delete', item.key);
              }
              const startedAt = now();
              const documentMarker = { kind: 'document' as const, owner: invocationKey, startedAt };
              const folderMarker = { kind: 'folder' as const, owner: invocationKey, startedAt, folderKeys: frozen.map((item) => item.key), documentKeys: ownedDocuments.map((item) => item.key) };
              for (const item of ownedDocuments) if (!await bound.setDocumentDeletion(item.key, documentMarker)) fail('CONTENT_CONFLICT', 'Document could not be frozen for deletion.', tool, 'transaction', item.key);
              for (const item of [...frozen].reverse()) if (!await bound.setFolderDeletion(item.key, folderMarker)) fail('CONTENT_CONFLICT', 'Folder could not be frozen for deletion.', tool, 'transaction', item.key);
              ownsFreeze = true;
              return { root: { ...candidate, _internalDeletion: folderMarker }, affected: frozen, documents: ownedDocuments };
            }));
            const related = await Promise.all(documents.map(async (item) => {
              const summaries = repo.listSummaries ? await repo.listSummaries(item.scopeKey, [item.key]) : [];
              return {
                document: item,
                versions: await repo.listVersions(item.scopeKey, [item.key]),
                shares: await repo.listShares(item.scopeKey, [item.key], { includeExpired: true, includeRevoked: true }),
                audioVersions: repo.listAudioVersions ? await repo.listAudioVersions(item.scopeKey, [item.key]) : [],
                summaries,
                summaryAudio: repo.listSummaryAudio ? await repo.listSummaryAudio(item.scopeKey, summaries.map((summary) => summary.key)) : [],
              };
            }));
            if (related.some((item) => item.audioVersions.length > 0) && !repo.deleteAudioVersion) fail('CONTENT_CONFLICT', 'Document audio deletion is unavailable.', tool, 'delete', key);
            if (related.some((item) => item.summaries.length > 0) && !repo.deleteSummary) fail('CONTENT_CONFLICT', 'Document summary deletion is unavailable.', tool, 'delete', key);
            if (related.some((item) => item.summaryAudio.length > 0) && !repo.deleteSummaryAudio) fail('CONTENT_CONFLICT', 'Document summary audio deletion is unavailable.', tool, 'delete', key);
            const inventoriedKeys = [...new Set(related.flatMap((item) => [item.document.storageKey, ...(item.document.speechStorageKeys ?? []), ...(item.document.sourceStorageKeys ?? []), ...item.audioVersions.map((audio) => audio.storageKey), ...item.summaryAudio.map((audio) => audio.storageKey)]).filter((item): item is string => Boolean(item)))];
            const manifest = root._internalDeletion?.objectKeys ? root._internalDeletion : { ...root._internalDeletion!, objectKeys: inventoriedKeys };
            if (!root._internalDeletion?.objectKeys) {
              const persisted = await repo.transaction((bound) => bound.setFolderDeletion(root.key, manifest, root._internalDeletion!.owner));
              if (!persisted) fail('CONTENT_CONFLICT', 'Folder deletion manifest ownership changed.', tool, 'transaction', key);
              root = persisted;
            }
            storageStarted = true;
            await deleteStorageKeys(manifest.objectKeys ?? [], root.key, root.scopeKey);
          const removeMetadata = async (bound: ContentRepository) => {
            for (const item of related) {
              for (const version of item.versions) await bound.deleteVersion(version.key);
              for (const audio of item.audioVersions) {
                if (!bound.deleteAudioVersion) fail('CONTENT_CONFLICT', 'Transaction-bound audio deletion is unavailable.', tool, 'transaction', audio.key);
                await bound.deleteAudioVersion(audio.key);
              }
              for (const audio of item.summaryAudio) {
                if (!bound.deleteSummaryAudio) fail('CONTENT_CONFLICT', 'Transaction-bound summary audio deletion is unavailable.', tool, 'transaction', audio.key);
                await bound.deleteSummaryAudio(audio.summaryKey);
              }
              for (const summary of item.summaries) {
                if (!bound.deleteSummary) fail('CONTENT_CONFLICT', 'Transaction-bound summary deletion is unavailable.', tool, 'transaction', summary.key);
                await bound.deleteSummary(summary.key);
              }
              for (const share of item.shares) await bound.deleteShare(share.key);
              await bound.deleteDocument(item.document.key);
            }
            for (const item of affected.reverse()) await bound.deleteFolder(item.key);
          };
            await repo.transaction(removeMetadata);
          } catch (error) {
            if (ownsFreeze && !storageStarted) await repo.transaction(async (bound) => {
              for (const item of documents) await bound.setDocumentDeletion(item.key, undefined, invocationKey);
              for (const item of affected) await bound.setFolderDeletion(item.key, undefined, invocationKey);
            }).catch(() => undefined);
            throw error;
          }
          return {};
        },
      })), input.atomic, repo);
    } else if (tool === 'document.parse') {
      await roleFor(input.scopeKey, 'moderator');
      await location(input.scopeKey, input.folderKey, 'moderator');
      const processingLogger = dependencies.ingestion?.logger;
      const processingInput = input.idempotencyKey ? {
        ...input,
        idempotencyKey: createHash('sha256').update(member.user.key).update('\0').update(input.idempotencyKey).digest('hex'),
      } : input;
      const processed = await d.parseDocument(processingInput, {
        ...dependencies.ingestion,
        ...(!dependencies.ingestion?.embed && !dependencies.ingestion?.embedBatch ? {
          embedBatch: ({ texts, purpose = 'document' }) => d.embedBatch(texts, purpose),
        } : {}),
        storage: d.storage,
        logger(processingEvent) {
          processingLogger?.(processingEvent);
          const status = processingEvent.status === 'started' ? 'started' : processingEvent.status === 'completed' ? 'succeeded' : 'failed';
          void event('action', status, typeof processingEvent.action === 'string' ? processingEvent.action : 'document.parse', typeof processingEvent.documentKey === 'string' ? processingEvent.documentKey : undefined, input.scopeKey, typeof processingEvent.durationMs === 'number' ? processingEvent.durationMs : undefined);
        },
      });
      result = { document: documentView(processed.document) };
    } else if (tool === 'document.scan') {
      await location(input.scopeKey, input.folderKey, 'moderator');
      const processingInput = { ...input, idempotencyKey: input.idempotencyKey ? createHash('sha256').update(member.user.key).update('\0').update(input.idempotencyKey).digest('hex') : invocationKey };
      const scan = dependencies.scanDocument ?? (await import('@/lib/ai/document-scanning')).scanDocumentImages;
      const deterministicKey = (await import('@/lib/ai/document-processing')).documentKeyForRequest(input.scopeKey, input.folderKey, processingInput.idempotencyKey);
      const replay = await repo.getDocument(deterministicKey);
      if (replay) result = { document: documentView(replay) };
      else {
        const processed = await scan(processingInput, context.organizationKey);
        try {
          const cleaned = await documentCleanup({ text: processed.content }, { logger: () => undefined });
          const transformed = await representations(cleaned.content, input.name ?? `Scanned document ${d.clock().toISOString().slice(0, 10)}`, processed.documentKey, input.scopeKey);
          const timestamp = now();
          const created = await repo.insertDocument({
            key: processed.documentKey,
            scopeKey: input.scopeKey,
            ...(input.folderKey ? { folderKey: input.folderKey } : {}),
            name: input.name ?? `Scanned document ${timestamp.slice(0, 10)}`,
            isFavorite: false,
            sourceStorageKeys: processed.storageKeys,
            ...transformed,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          result = { document: documentView(created) };
        } catch (error) {
          let committed: Document | null;
          try {
            committed = await repo.getDocument(processed.documentKey);
          } catch (ownershipError) {
            throw new ContentError('CONTENT_CONFLICT', 'Document ownership could not be verified after scanning failed; source images were retained for safe reconciliation.', tool, {
              action: 'cleanup',
              resourceKey: processed.documentKey,
              retryable: true,
              cause: new AggregateError([error, ownershipError], 'Document scanning and ownership verification failed.'),
            });
          }
          if (committed) result = { document: documentView(committed) };
          else {
            const cleanup = await Promise.allSettled(processed.storageKeys.map((key) => d.storage.delete(key)));
            const cleanupErrors = cleanup.flatMap((outcome) => outcome.status === 'rejected' ? [outcome.reason] : []);
            if (cleanupErrors.length) throw new ContentError('CONTENT_CONFLICT', 'Document scanning failed and its source images could not be fully cleaned up.', tool, {
              action: 'cleanup',
              resourceKey: processed.documentKey,
              retryable: true,
              cause: new AggregateError([error, ...cleanupErrors], 'Document scanning and source cleanup failed.'),
            });
            throw error;
          }
        }
      }
    } else if (tool === 'document.create') {
      await location(input.scopeKey, input.folderKey, 'moderator');
      const key = d.id();
      const transformed = await representations(input.content, input.name, key, input.scopeKey);
      const timestamp = now();
      const created = await repo.insertDocument({
        key,
        scopeKey: input.scopeKey,
        ...(input.folderKey ? { folderKey: input.folderKey } : {}),
        name: input.name,
        isFavorite: false,
        ...transformed,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      result = { document: documentView(created) };
    } else if (tool === 'document.find') {
      result = await batch(tool, input.documentKeys.map((key: string) => ({
        key,
        run: async () => {
          const current = await document(key);
          const include: string[] = input.include ?? [];
          const latest = include.includes('latestVersion') ? (await repo.listVersions(current.scopeKey, [current.key]))[0] : undefined;
          const parent = include.includes('folder') && current.folderKey ? await repo.getFolder(current.folderKey) : undefined;
          return {
            document: {
              ...documentView(current),
              ...(include.includes('content') ? { content: current.content } : {}),
              ...(include.includes('embedding') ? { embedding: current.embedding } : {}),
              ...(parent ? { folder: await folderView(parent, d) } : {}),
              ...(include.includes('shares') ? { shares: (await repo.listShares(current.scopeKey, [current.key])).map(shareView) } : {}),
              ...(latest ? { latestVersion: versionView(latest) } : {}),
              ...(include.includes('sourceImages') ? { sourceImages: await Promise.all((current.sourceStorageKeys ?? []).map(async (storageKey, index) => ({ page: index + 1, url: await d.signDocumentSourceUrl(storageKey) }))) } : {}),
            },
          };
        },
      })), false, repo);
    } else if (tool === 'document.list') {
      const parent = await location(input.scopeKey, input.folderKey, 'viewer');
      const values = (await repo.listDocuments(input.scopeKey))
        .filter((item) => !item._internalDeletion && item.folderKey === parent?.key && (!input.extensions || item.extension !== undefined && input.extensions.includes(item.extension)));
      const sort = input.sort ?? { field: 'name', direction: 'asc' };
      values.sort((left: any, right: any) => String(left[sort.field]).localeCompare(String(right[sort.field])) * (sort.direction === 'asc' ? 1 : -1));
      const offset = input.cursor ? Number(Buffer.from(input.cursor, 'base64url').toString()) || 0 : 0;
      const limit = input.limit ?? 50;
      result = {
        documents: values.slice(offset, offset + limit).map(documentView),
        ...(offset + limit < values.length ? { cursor: Buffer.from(String(offset + limit)).toString('base64url') } : {}),
      };
    } else if (tool === 'document.read') {
      result = await batch(tool, input.documentKeys.map((key: string) => ({
        key,
        run: async () => {
          const current = await document(key, 'viewer', false);
          return { documentKey: key, title: current.name, content: current.content };
        },
      })), false, repo);
    } else if (tool === 'document.update') {
      const hasRepresentationUpdates = input.updates.some((item: any) => item.content !== undefined);
      if (input.atomic && hasRepresentationUpdates) fail('CONTENT_CONFLICT', 'Atomic document updates are unavailable because transformation and embedding actions are external side effects.', tool, 'document-embed');
      const updates = input.updates.map((item: any) => ({
        key: item.documentKey,
        preflight: async () => { await document(item.documentKey, 'moderator', false); },
        run: async (mutationRepository: ContentRepository) => {
          const current = await document(item.documentKey, 'moderator', false);
          if (item.expectedUpdatedAt && current.updatedAt !== item.expectedUpdatedAt) fail('DOCUMENT_VERSION_CONFLICT', 'Document changed after it was read.', tool, 'update', current.key);
          const hasRepresentation = item.content !== undefined;
          const transformed = hasRepresentation ? await representations(item.content, current.name, current.key, current.scopeKey) : undefined;
          let backup: DocumentVersion | undefined;
          if (item.createVersion) {
            backup = await mutationRepository.createVersion({
              scopeKey: current.scopeKey,
              documentKey: current.key,
              content: current.content,
              ...await currentVersionSemantics(current, current.name),
            });
          }
          try {
            const updated = await mutationRepository.updateDocument(current.key, {
              ...(transformed ?? {}),
              ...(hasRepresentation ? { currentVersionKey: null } : {}),
              ...(item.isFavorite !== undefined ? { isFavorite: item.isFavorite } : {}),
              updatedAt: nextUpdatedAt(current.updatedAt),
            }, { expectedUpdatedAt: item.expectedUpdatedAt });
            return { document: documentView(updated) };
          } catch (error) {
            if (backup) {
              try { await mutationRepository.deleteVersion(backup.key); }
              catch (cleanupError) { throw new ContentError('CONTENT_CONFLICT', 'Document update failed and version compensation requires retry.', tool, { action: 'cleanup', resourceKey: current.key, cause: new AggregateError([error, cleanupError]), retryable: true }); }
            }
            if (item.expectedUpdatedAt && error instanceof Error && error.message === 'Document update conflict.') fail('DOCUMENT_VERSION_CONFLICT', 'Document changed after it was read.', tool, 'update', current.key);
            throw error;
          }
        },
      }));
      result = await batch(tool, updates, input.atomic, repo);
    } else if (tool === 'document.rename') {
      if (input.atomic) fail('CONTENT_CONFLICT', 'Atomic document rename is unavailable because embedding is an external side effect.', tool, 'document-embed');
      result = await batch(tool, input.renames.map((item: any) => ({
        key: item.documentKey,
        preflight: async () => { await document(item.documentKey, 'moderator', false); },
        run: async (mutationRepository: ContentRepository) => {
          const current = await document(item.documentKey, 'moderator', false);
          const semantics = await generatedSemantics(item.name, current.content, current.key, current.scopeKey);
          const renamed = await mutationRepository.updateDocument(current.key, { name: item.name, ...semantics, updatedAt: nextUpdatedAt(current.updatedAt) });
          return { document: documentView(renamed) };
        },
      })), input.atomic, repo);
    } else if (tool === 'document.move') {
      result = await batch(tool, input.moves.map((item: any) => ({
        key: item.documentKey,
        preflight: async () => {
          const source = await document(item.documentKey, 'admin', false);
          await location(item.targetScopeKey, item.targetFolderKey, 'admin');
          if (source.scopeKey !== item.targetScopeKey) fail('FOLDER_MOVE_FORBIDDEN', 'Cross-scope document moves are not supported.', tool, 'update', source.key);
        },
        run: async (mutationRepository: ContentRepository) => {
          const current = await document(item.documentKey, 'admin', false);
          const moved = await mutationRepository.updateDocument(current.key, { folderKey: item.targetFolderKey, updatedAt: now() });
          return { document: documentView(moved) };
        },
      })), input.atomic, repo);
    } else if (tool === 'document.copy') {
      if (input.atomic) fail('CONTENT_CONFLICT', 'Atomic copy is unavailable because storage copy cannot be rolled back transactionally.', tool, 'storage');
      result = await batch(tool, input.copies.map((item: any) => ({
        key: item.documentKey,
        run: async () => {
          const source = await document(item.documentKey, 'viewer', false);
          const target = await location(item.targetScopeKey, item.targetFolderKey, 'moderator');
          const key = d.id();
          const name = item.newName ?? source.name;
          const storageKey = source.storageKey && source.extension
            ? `content/${context.organizationKey}/${item.targetScopeKey}/${key}/original.${source.extension}`
            : undefined;
          const insertedVersionKeys: string[] = [];
          const insertedShareKeys: string[] = [];
          let insertedDocument = false;
          if (storageKey && source.storageKey) await storageOperation('copy', key, item.targetScopeKey, () => d.storage.copy({ sourceKey: source.storageKey!, destinationKey: storageKey, mimeType: source.mimeType }));
          try {
            const semantics = await currentDocumentSemantics(source, name);
            const timestamp = now();
            const copy = await repo.insertDocument({
              ...source,
              key,
               scopeKey: item.targetScopeKey,
               ...(target ? { folderKey: target.key } : { folderKey: undefined }),
              name,
              isFavorite: false,
              ...semantics,
               ...(storageKey ? { storageKey } : {}),
              sourceStorageKeys: undefined,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            insertedDocument = true;
            if (item.includeVersions) {
              const versions = (await repo.listVersions(source.scopeKey, [source.key])).sort((left, right) => left.version - right.version);
              for (const version of versions) {
                const created = await repo.createVersion({
                   scopeKey: item.targetScopeKey,
                  documentKey: key,
                  label: version.label,
                   content: version.content,
                  ...await currentVersionSemantics(version, name),
                });
                insertedVersionKeys.push(created.key);
              }
            }
            const createdShares: Array<{ share: ReturnType<typeof shareView>; token: string }> = [];
            if (item.includeShares) {
              const sourceShares = await repo.listShares(source.scopeKey, [source.key]);
              for (const sourceShare of sourceShares) {
                const token = Buffer.from(d.random(32)).toString('base64url');
                const created = await repo.insertShare({
                  key: d.id(),
                   scopeKey: item.targetScopeKey,
                  documentKey: key,
                  permission: sourceShare.permission,
                  tokenHash: createHash('sha256').update(token).digest('hex'),
                  ...(sourceShare.expiresAt ? { expiresAt: sourceShare.expiresAt } : {}),
                  createdAt: timestamp,
                  updatedAt: timestamp,
                });
                insertedShareKeys.push(created.key);
                createdShares.push({ share: shareView(created), token });
              }
            }
            return { document: documentView(copy), ...(createdShares.length ? { shares: createdShares } : {}) };
          } catch (error) {
            try {
              for (const shareKey of insertedShareKeys.reverse()) await repo.deleteShare(shareKey);
              for (const versionKey of insertedVersionKeys.reverse()) await repo.deleteVersion(versionKey);
              if (insertedDocument) await repo.deleteDocument(key);
               if (storageKey) await storageOperation('delete', key, item.targetScopeKey, () => d.storage.delete(storageKey));
            } catch (cleanupError) {
              throw new ContentError('CONTENT_CONFLICT', 'Document copy failed and compensation requires retry.', tool, { action: 'cleanup', resourceKey: key, cause: new AggregateError([error, cleanupError]), retryable: true });
            }
            throw error;
          }
        },
      })), false, repo);
    } else if (tool === 'document.delete') {
      if (input.atomic) fail('CONTENT_CONFLICT', 'Atomic deletion is unavailable because storage deletion cannot be rolled back.', tool, 'storage');
      result = await batch(tool, input.documentKeys.map((key: string) => ({
        key,
        preflight: async () => {
          const current = await document(key, 'owner', true);
          if (current.isFavorite) fail('CONTENT_CONFLICT', 'Unfavorite the document before deleting it.', tool, 'delete', key);
        },
        run: async () => {
          if (!repo.transaction) fail('CONTENT_CONFLICT', 'Transaction-bound metadata deletion is unavailable.', tool, 'transaction', key);
          let ownsFreeze = false;
          let storageStarted = false;
          let current = await repo.transaction(async (bound) => {
            const candidate = await bound.getDocument(key);
            if (!candidate) fail('CONTENT_NOT_FOUND', 'Document was not found.', tool, 'read', key);
            if (candidate._internalDeletion) {
              if (candidate._internalDeletion.kind !== 'document') fail('CONTENT_CONFLICT', 'A different deletion is already pending.', tool, 'delete', key);
              return candidate;
            }
            const marker = { kind: 'document' as const, owner: invocationKey, startedAt: now() };
            const frozen = await bound.setDocumentDeletion(key, marker);
            if (!frozen) fail('CONTENT_CONFLICT', 'Document could not be frozen for deletion.', tool, 'transaction', key);
            ownsFreeze = true;
            return frozen;
          });
          try {
            const versions = await repo.listVersions(current.scopeKey, [key]);
            const shares = await repo.listShares(current.scopeKey, [key], { includeExpired: true, includeRevoked: true });
            const audioVersions = repo.listAudioVersions ? await repo.listAudioVersions(current.scopeKey, [key]) : [];
            const summaries = repo.listSummaries ? await repo.listSummaries(current.scopeKey, [key]) : [];
            const summaryAudio = repo.listSummaryAudio ? await repo.listSummaryAudio(current.scopeKey, summaries.map((summary) => summary.key)) : [];
            if (audioVersions.length > 0 && !repo.deleteAudioVersion) fail('CONTENT_CONFLICT', 'Document audio deletion is unavailable.', tool, 'delete', key);
            if (summaries.length > 0 && !repo.deleteSummary) fail('CONTENT_CONFLICT', 'Document summary deletion is unavailable.', tool, 'delete', key);
            if (summaryAudio.length > 0 && !repo.deleteSummaryAudio) fail('CONTENT_CONFLICT', 'Document summary audio deletion is unavailable.', tool, 'delete', key);
            const inventoriedKeys = [...new Set([current.storageKey, ...(current.speechStorageKeys ?? []), ...(current.sourceStorageKeys ?? []), ...audioVersions.map((audio) => audio.storageKey), ...summaryAudio.map((audio) => audio.storageKey)].filter((item): item is string => Boolean(item)))];
            const deletion = current._internalDeletion?.objectKeys ? current._internalDeletion : { ...current._internalDeletion!, objectKeys: inventoriedKeys };
            if (!current._internalDeletion?.objectKeys) {
              const persisted = await repo.transaction((bound) => bound.setDocumentDeletion(key, deletion, current._internalDeletion!.owner));
              if (!persisted) fail('CONTENT_CONFLICT', 'Document deletion manifest ownership changed.', tool, 'transaction', key);
              current = persisted;
            }
            storageStarted = true;
            await deleteStorageKeys(deletion.objectKeys ?? [], key, current.scopeKey);
            await repo.transaction(async (bound) => {
              for (const version of versions) await bound.deleteVersion(version.key);
              for (const audio of audioVersions) {
                if (!bound.deleteAudioVersion) fail('CONTENT_CONFLICT', 'Transaction-bound audio deletion is unavailable.', tool, 'transaction', audio.key);
                await bound.deleteAudioVersion(audio.key);
              }
              for (const audio of summaryAudio) {
                if (!bound.deleteSummaryAudio) fail('CONTENT_CONFLICT', 'Transaction-bound summary audio deletion is unavailable.', tool, 'transaction', audio.key);
                await bound.deleteSummaryAudio(audio.summaryKey);
              }
              for (const summary of summaries) {
                if (!bound.deleteSummary) fail('CONTENT_CONFLICT', 'Transaction-bound summary deletion is unavailable.', tool, 'transaction', summary.key);
                await bound.deleteSummary(summary.key);
              }
              for (const share of shares) await bound.deleteShare(share.key);
              await bound.deleteDocument(key);
            });
          } catch (error) {
            if (ownsFreeze && !storageStarted) await repo.transaction((bound) => bound.setDocumentDeletion(key, undefined, invocationKey)).catch(() => undefined);
            throw error;
          }
          return {};
        },
      })), false, repo);
    } else if (tool === 'document.download' || tool === 'document.export') {
      const items = tool === 'document.download'
        ? input.documentKeys.map((documentKey: string) => ({ documentKey, format: input.format }))
        : input.exports;
      const byteBudget = Math.min(Math.max(dependencies.maxDownloadBytes ?? 25_000_000, 1), 100_000_000);
      let downloadedBytes = 0;
      const fileOperations = items.map((item: any) => ({
        key: item.documentKey,
        run: async () => {
          const current = await document(item.documentKey, 'viewer', false);
          if (item.format === 'original') {
            if (!current.storageKey || !current.extension || !current.mimeType) fail('CONTENT_NOT_FOUND', 'This document has no imported original to download.', tool, 'storage', current.key);
            const object = await storageOperation('download', current.key, current.scopeKey, () => d.storage.download(current.storageKey!));
            downloadedBytes += object.bytes.byteLength;
            if (downloadedBytes > byteBudget) fail('DOCUMENT_TOO_LARGE', 'Combined download byte budget exceeded.', tool, 'storage', current.key);
            return {
              documentKey: current.key,
              format: 'original',
              fileName: downloadFileName(current.name, current.extension!),
              mimeType: object.mimeType ?? current.mimeType!,
              encoding: 'base64' as const,
              content: Buffer.from(object.bytes).toString('base64'),
            };
          }
          if (item.format === 'html') {
            if (!current.storageKey || !current.extension || current.extension === 'pdf') fail('CONTENT_NOT_FOUND', 'This document has no supported original preview.', tool, 'storage', current.key);
            const object = await storageOperation('download', current.key, current.scopeKey, () => d.storage.download(current.storageKey!));
            if (object.bytes.byteLength > byteBudget - downloadedBytes) fail('DOCUMENT_TOO_LARGE', 'Combined download byte budget exceeded.', tool, 'storage', current.key);
            const preview = await (dependencies.generatePreview ?? (await import('@/lib/ai/document-processing/preview')).generateDocumentPreview)({ extension: current.extension, bytes: object.bytes });
            downloadedBytes += preview.bytes.byteLength;
            if (downloadedBytes > byteBudget) fail('DOCUMENT_TOO_LARGE', 'Combined preview byte budget exceeded.', tool, 'storage', current.key);
            return {
              documentKey: current.key,
              format: 'html',
              fileName: downloadFileName(current.name, preview.extension),
              mimeType: preview.mimeType,
              encoding: 'base64' as const,
              content: Buffer.from(preview.bytes).toString('base64'),
            };
          }
          const exported = await d.generateExport({ format: item.format, content: current.content });
          downloadedBytes += exported.bytes.byteLength;
          if (downloadedBytes > byteBudget) fail('DOCUMENT_TOO_LARGE', 'Combined export byte budget exceeded.', tool, 'export', current.key);
          return {
            documentKey: current.key,
            format: exported.extension,
            fileName: downloadFileName(current.name, exported.extension),
            mimeType: exported.mimeType,
            encoding: 'base64' as const,
            content: Buffer.from(exported.bytes).toString('base64'),
          };
        },
      }));
      if (tool === 'document.export' && input.atomic) {
        const results = [];
        for (const operation of fileOperations) {
          try { results.push({ key: operation.key, success: true, data: await operation.run() }); }
          catch (error) { throw mappedError(error, tool, 'export', operation.key); }
        }
        result = { results, summary: { requested: results.length, succeeded: results.length, failed: 0 } };
      } else result = await batch(tool, fileOperations, false, repo);
    } else if (tool === 'document.share') {
      if (input.atomic) fail('CONTENT_CONFLICT', 'Atomic share creation is unavailable because secure randomness cannot be rolled back.', tool, 'insert');
      result = await batch(tool, input.shares.map((item: any) => ({
        key: item.documentKey,
        preflight: async () => {
          await document(item.documentKey, 'moderator', false);
          if (item.expiresAt && item.expiresAt <= now()) fail('DOCUMENT_SHARE_INVALID', 'Share expiry must be in the future.', tool, 'insert', item.documentKey);
        },
        run: async () => {
          const current = await document(item.documentKey, 'moderator', false);
          const token = Buffer.from(d.random(32)).toString('base64url');
          const timestamp = now();
          const share = await repo.insertShare({
            key: d.id(),
            scopeKey: current.scopeKey,
            documentKey: current.key,
            permission: item.permission,
            tokenHash: createHash('sha256').update(token).digest('hex'),
            ...(item.password ? { passwordHash: await hashPassword(item.password, d.random) } : {}),
            ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          return { share: shareView(share), token };
        },
      })), false, repo);
    } else if (tool === 'document.unshare') {
      const selectors: string[] = input.shareKeys ?? input.documentKeys;
      result = await batch(tool, selectors.map((key: string) => ({
        key,
        preflight: async () => {
          if (input.shareKeys) {
            const share = await repo.getShare(key);
            if (!share) fail('CONTENT_NOT_FOUND', 'Share was not found.', tool, 'read', key);
            await document(share.documentKey, 'viewer');
            await roleFor(share.scopeKey, 'moderator', key);
          } else {
            const current = await document(key, 'moderator');
            const shares = await repo.listShares(current.scopeKey, [key], { includeExpired: true, includeRevoked: true });
            if (shares.length === 0) fail('CONTENT_NOT_FOUND', 'Document has no shares to revoke.', tool, 'read', key);
          }
        },
        run: async (mutationRepository: ContentRepository) => {
          const timestamp = now();
          if (input.shareKeys) {
            const share = await repo.getShare(key);
            if (!share) fail('CONTENT_NOT_FOUND', 'Share was not found.', tool, 'read', key);
            await document(share.documentKey, 'viewer');
            return { share: shareView(await mutationRepository.updateShare(key, { revokedAt: timestamp, updatedAt: timestamp })) };
          }
          const current = await document(key, 'moderator');
          const shares = await repo.listShares(current.scopeKey, [key], { includeExpired: true, includeRevoked: true });
          const revoked = [];
          for (const share of shares) revoked.push(shareView(await mutationRepository.updateShare(share.key, { revokedAt: timestamp, updatedAt: timestamp })));
          return { documentKey: key, shares: revoked };
        },
      })), input.atomic, repo);
    } else if (tool === 'document.list-shares') {
      result = await batch(tool, input.documentKeys.map((key: string) => ({
        key,
        run: async () => {
          const current = await document(key, 'moderator');
          const shares = await repo.listShares(current.scopeKey, [key], { includeExpired: input.includeExpired, includeRevoked: input.includeRevoked, at: now() });
          return { documentKey: key, shares: shares.map(shareView) };
        },
      })), false, repo);
    } else if (tool === 'document.create-version') {
      result = await batch(tool, input.documentKeys.map((key: string) => ({
        key,
        preflight: async () => { await document(key, 'moderator', false); },
        run: async (mutationRepository: ContentRepository) => {
          const current = await document(key, 'moderator', false);
          const content = input.contents?.[key] ?? current.content;
          const version = await mutationRepository.createVersion({
            scopeKey: current.scopeKey,
            documentKey: key,
            type: input.types?.[key],
            label: input.labels?.[key],
            content,
            ...await currentVersionSemantics({ ...current, content }, current.name),
          });
          if (content === current.content) await mutationRepository.updateDocument(current.key, { currentVersionKey: version.key });
          return { version: versionView(version) };
        },
      })), input.atomic, repo);
    } else if (tool === 'document.find-version') {
      result = await batch(tool, input.versionKeys.map((key: string) => ({
        key,
        run: async () => {
          const version = await repo.getVersion(key);
          if (!version) fail('CONTENT_NOT_FOUND', 'Version was not found.', tool, 'read', key);
          await document(version.documentKey, 'viewer');
          await roleFor(version.scopeKey, 'viewer', key);
          return { version: versionView(version, input.include) };
        },
      })), false, repo);
    } else if (tool === 'document.audio.playback.update') {
      if (!repo.getAudioVersion || !repo.updateAudioPlayback) fail('CONTENT_CONFLICT', 'Document audio playback state is unavailable.', tool, 'update', input.audioVersionKey);
      const audio = await repo.getAudioVersion(input.audioVersionKey);
      if (!audio) fail('CONTENT_NOT_FOUND', 'Audio version was not found.', tool, 'update', input.audioVersionKey);
      await document(audio.documentKey, 'viewer', false);
      if (input.playbackPositionMs > audio.durationMs) fail('CONTENT_INVALID_INPUT', 'Playback position cannot exceed audio duration.', tool, 'update', input.audioVersionKey);
      const updated = await repo.updateAudioPlayback(audio.scopeKey, audio.key, input.playbackPositionMs);
      if (!updated) fail('CONTENT_CONFLICT', 'Audio playback state could not be updated.', tool, 'update', input.audioVersionKey);
      result = { audioVersionKey: updated.key, documentKey: updated.documentKey, playbackPositionMs: updated.playbackPositionMs };
    } else if (tool === 'document.audio.playback.clear') {
      const current = await document(input.documentKey, 'viewer', false);
      if (!repo.clearCurrentAudioVersion) fail('CONTENT_CONFLICT', 'Document audio playback state is unavailable.', tool, 'update', input.documentKey);
      await repo.clearCurrentAudioVersion(current.scopeKey, current.key);
      result = { documentKey: current.key };
    } else if (tool === 'document.list-audio-versions') {
      result = await batch(tool, input.documentKeys.map((key: string) => ({
        key,
        run: async () => {
          const current = await document(key, 'viewer');
          if (!repo.listAudioVersions) fail('CONTENT_CONFLICT', 'Document audio history is unavailable.', tool, 'read', key);
          let versions: DocumentAudioVersion[];
          try {
            versions = await repo.listAudioVersions(current.scopeKey, [key]);
          } catch (error) {
            throw new ContentError('DOCUMENT_SPEECH_FAILED', 'Audio version history could not be loaded.', tool, { action: 'audio-history', resourceKey: key, cause: error, retryable: true });
          }
          const offset = input.cursor ? Number(Buffer.from(input.cursor, 'base64url').toString()) || 0 : 0;
          const limit = input.limit ?? 50;
          return {
            documentKey: key,
            audioVersions: await Promise.all(versions.slice(offset, offset + limit).map((version) => audioVersionView(version, current, d.signAudioUrl))),
            ...(offset + limit < versions.length ? { cursor: Buffer.from(String(offset + limit)).toString('base64url') } : {}),
          };
        },
      })), false, repo);
    } else if (tool === 'document.list-versions') {
      result = await batch(tool, input.documentKeys.map((key: string) => ({
        key,
        run: async () => {
          const current = await document(key, 'viewer');
          const versions = await repo.listVersions(current.scopeKey, [key]);
          const offset = input.cursor ? Number(Buffer.from(input.cursor, 'base64url').toString()) || 0 : 0;
          const limit = input.limit ?? 50;
          return {
            documentKey: key,
            versions: versions.slice(offset, offset + limit).map((version) => versionView(version)),
            ...(offset + limit < versions.length ? { cursor: Buffer.from(String(offset + limit)).toString('base64url') } : {}),
          };
        },
      })), false, repo);
    } else if (tool === 'document.restore-version') {
      result = await batch(tool, input.restores.map((item: any) => ({
        key: item.documentKey,
        preflight: async () => {
          const current = await document(item.documentKey, 'moderator', false);
          const rawVersion = await repo.getVersion(item.versionKey);
          const version = rawVersion ? documentVersionSchema.safeParse(rawVersion) : null;
          if (!version?.success || version.data.documentKey !== current.key || version.data.scopeKey !== current.scopeKey) {
            fail('DOCUMENT_VERSION_CONFLICT', 'A complete version belonging to the document is required.', tool, 'read', item.versionKey);
          }
        },
        run: async (mutationRepository: ContentRepository) => {
          const current = await document(item.documentKey, 'moderator', false);
          const version = documentVersionSchema.parse(await repo.getVersion(item.versionKey));
          let backup: DocumentVersion | undefined;
          if (item.createBackupVersion) {
            backup = await mutationRepository.createVersion({
              scopeKey: current.scopeKey,
              documentKey: current.key,
              content: current.content,
              ...await currentVersionSemantics(current, current.name),
            });
          }
          try {
            const restored = await mutationRepository.updateDocument(current.key, {
              content: version.content,
              currentVersionKey: version.key,
              ...await restoredVersionSemantics(version, current.name),
              updatedAt: now(),
            });
            return { document: documentView(restored) };
          } catch (error) {
            if (backup && !input.atomic) await mutationRepository.deleteVersion(backup.key).catch(() => undefined);
            throw error;
          }
        },
      })), input.atomic, repo);
    } else if (tool === 'document.delete-version') {
      result = await batch(tool, input.versionKeys.map((key: string) => ({
        key,
        preflight: async () => {
          const version = await repo.getVersion(key);
          if (!version) fail('CONTENT_NOT_FOUND', 'Version was not found.', tool, 'read', key);
          const current = await document(version.documentKey, 'owner', true);
          if (current._internalDeletion) fail('CONTENT_CONFLICT', 'Document deletion is already pending.', tool, 'delete', key);
        },
        run: async (mutationRepository: ContentRepository) => {
          const selected = await repo.getVersion(key);
          if (!selected) fail('CONTENT_NOT_FOUND', 'Version was not found.', tool, 'read', key);
          if (input.atomic) await mutationRepository.deleteVersion(selected.key);
          else {
            if (!repo.transaction) fail('CONTENT_CONFLICT', 'Transaction-bound version deletion is unavailable.', tool, 'transaction', key);
            await repo.transaction((bound) => bound.deleteVersion(selected.key));
          }
          return {};
        },
      })), input.atomic, repo);
    } else if (tool === 'document.list-summaries') {
      result = await batch(tool, input.documentKeys.map((key: string) => ({
        key,
        run: async () => {
          const current = await document(key, 'viewer');
          if (!repo.listSummaries) fail('CONTENT_CONFLICT', 'Document summary history is unavailable.', tool, 'read', key);
           const summaries = await repo.listSummaries(current.scopeKey, [key]);
           const offset = input.cursor ? Number(Buffer.from(input.cursor, 'base64url').toString()) || 0 : 0;
           const limit = input.limit ?? 50;
           const page = summaries.slice(offset, offset + limit);
           const audio = repo.listSummaryAudio ? await repo.listSummaryAudio(current.scopeKey, page.map((summary) => summary.key)) : [];
           const audioBySummary = new Map(audio.map((item) => [item.summaryKey, item]));
           return { documentKey: key, summaries: await Promise.all(page.map((summary) => projectedSummaryView(summary, audioBySummary.get(summary.key), d.signAudioUrl))), ...(offset + limit < summaries.length ? { cursor: Buffer.from(String(offset + limit)).toString('base64url') } : {}) };
        },
      })), false, repo);
    } else if (tool === 'document.find-summary') {
      result = await batch(tool, input.summaryKeys.map((key: string) => ({
        key,
        run: async () => {
          if (!repo.getSummary) fail('CONTENT_CONFLICT', 'Document summary history is unavailable.', tool, 'read', key);
          const summary = await repo.getSummary(key);
          if (!summary) fail('CONTENT_NOT_FOUND', 'Summary was not found.', tool, 'read', key);
           const current = await document(summary.documentKey, 'viewer');
           if (current.scopeKey !== summary.scopeKey) fail('CONTENT_NOT_FOUND', 'Summary was not found.', tool, 'read', key);
           const audio = repo.getSummaryAudio ? await repo.getSummaryAudio(summary.key) : null;
           return { summary: await projectedSummaryView(summary, audio ?? undefined, d.signAudioUrl) };
         },
       })), false, repo);
    } else if (tool === 'document.topics') {
      const current = await document(input.documentKey, 'viewer', false);
      const generated = await action('document-topics', {
        systemPrompt: 'Identify the document\'s distinct primary topics. Return strict JSON only in the form {"topics":["topic"]}. Include no more than 10 concise topic strings, with no duplicates or commentary.',
        messages: [{ role: 'user', content: [{ type: 'text', text: `Title: ${current.name}\n\n${current.content}` }] }],
        options: { temperature: 0.1, maxTokens: 500 },
      }, current.key, current.scopeKey);
      let parsed: { topics: string[] };
      try {
        const text = z.string().trim().min(1).parse(generated.text);
        const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(text);
        parsed = z.object({ topics: z.array(z.string().trim().min(1).max(200)).max(10) }).strict().parse(JSON.parse(fenced?.[1]?.trim() ?? text));
      } catch (error) {
        fail('CONTENT_INVALID_INPUT', 'The topic model returned invalid JSON.', tool, 'document-topics', current.key, error);
      }
      result = { documentKey: current.key, topics: [...new Set(parsed.topics)].slice(0, 10) };
    } else if (tool === 'document.summarize') {
      if (input.atomic && input.persist) fail('CONTENT_CONFLICT', 'Atomic persisted summaries are unavailable because generation is an external side effect.', tool, 'document-summarize');
      const sources: Document[] = [];
      for (const key of input.documentKeys) sources.push(await document(key, input.persist ? 'moderator' : 'viewer', false));
      const generateSummary = async (sourceDocuments: Document[]) => {
        const generated = await action('document-summarize', {
          systemPrompt: `Create a ${input.style} summary${input.topic ? ` focused on ${input.topic}` : ''}${input.language ? ` in ${input.language}` : ''}. Use only the supplied document content and preserve its facts. Return strict JSON only in the form {"sections":[{"heading":"Short heading","body":"Prose paragraph"}]}. Return 2 to 4 distinct sections. Bodies must be concise prose paragraphs, never bullet points or numbered lists. Do not include analysis, reasoning, planning, self-reference, a preamble, a conclusion about the task, Markdown, code fences, or commentary. Output the JSON object and nothing else.`,
          messages: [{ role: 'user', content: [{ type: 'text', text: sourceDocuments.map((item) => `Title: ${item.name}\n\n${item.content}`).join('\n\n---\n\n') }] }],
          options: { temperature: 0.2, maxTokens: 5_000 },
        }, sourceDocuments[0]!.key, sourceDocuments[0]!.scopeKey);
        return sectionedGeneratedSummary(generated.text);
      };
      if (input.combine) {
        const text = await generateSummary(sources);
        result = { results: sources.map((source) => ({ key: source.key, success: true, data: { documentKey: source.key, text } })), summary: { requested: sources.length, succeeded: sources.length, failed: 0 } };
      } else {
        result = await batch(tool, sources.map((current) => ({
          key: current.key,
          run: async () => {
            const text = await generateSummary([current]);
             if (!input.persist) return { documentKey: current.key, text };
             if (!repo.createSummary) fail('CONTENT_CONFLICT', 'Document summary persistence is unavailable.', tool, 'create', current.key);
             const summary = await repo.createSummary({ key: d.id(), scopeKey: current.scopeKey, documentKey: current.key, summary: text, ...(input.topic ? { topic: input.topic } : {}), style: input.style, ...(input.language ? { language: input.language } : {}), sourceContentHash: documentSemanticHash(current.content), sourceTitle: current.name, sourceDocumentUpdatedAt: current.updatedAt, createdByKey: member.userOrganization.key, createdAt: now() });
             const audio = repo.getSummaryAudio ? await repo.getSummaryAudio(summary.key) : null;
             return { documentKey: current.key, text, summary: await projectedSummaryView(summary, audio ?? undefined, d.signAudioUrl) };
          },
        })), false, repo);
      }
    } else if (tool === 'document.enhance' || tool === 'document.translate' || tool === 'document.rewrite') {
      const items = tool === 'document.rewrite'
        ? input.rewrites
        : input.documentKeys.map((documentKey: string) => ({
          documentKey,
          mode: input.mode,
        }));
      if (input.atomic && items.some((item: any) => item.mode !== 'preview')) fail('CONTENT_CONFLICT', 'Atomic persisted AI transformations are unavailable because generation and storage cannot be rolled back.', tool, 'reason');

      result = await batch(tool, items.map((item: any) => ({
          key: item.documentKey,
          run: async () => {
            const current = await document(item.documentKey, item.mode === 'preview' ? 'viewer' : 'moderator', false);
            const instruction = tool === 'document.translate'
                ? `Translate to ${input.targetLanguage}${input.sourceLanguage ? ` from ${input.sourceLanguage}` : ''}. ${input.preserveFormatting ? 'Preserve headings, lists, tables, paragraph boundaries, and inline emphasis.' : 'Return clear translated prose.'}`
                : `${item.instruction}${item.tone ? ` Tone: ${item.tone}.` : ''}${item.audience ? ` Audience: ${item.audience}.` : ''}${item.length ? ` Length: ${item.length}.` : ''}`;
            const text = tool === 'document.enhance'
              ? z.string().trim().min(1).parse((await action('enhance', {
                systemPrompt: `Correct spelling, grammar, awkward wording, and unclear phrasing. Repair or remove nonsensical words, isolated stray characters, corrupted fragments, and OCR artifacts when their intended meaning can be inferred from context. Reconstruct words, sentences, and paragraphs broken by artificial hard line wraps, including input with only a few characters per line. Join those artificial breaks so prose uses normal line width, while preserving intentional headings, lists, and paragraph boundaries. Preserve the original meaning, facts, tone, and useful structure. Trim leading and trailing whitespace, remove trailing spaces, collapse excessive blank lines, and organize longer content into readable sections with concise plain-text headings when the material supports them. Do not force headings into short content. Do not add new claims, Markdown decoration, or commentary. ${input.instruction ? `Additional direction: ${input.instruction} ` : ''}Return only the revised text.`,
                messages: [{ role: 'user', content: [{ type: 'text', text: current.content }] }],
                options: { temperature: 0.1, maxTokens: Math.min(5_000, Math.max(256, Math.ceil(current.content.length / 3))) },
              }, current.key, current.scopeKey)).text)
                .replace(/^```(?:text)?\s*/i, '')
                .replace(/\s*```$/i, '')
                .replace(/\r\n?/g, '\n')
                .replace(/[ \t]+\n/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim()
              : tool === 'document.translate'
              ? z.string().trim().min(1).parse((await action('translate', {
                systemPrompt: `Translate the supplied text${input.sourceLanguage ? ` from ${input.sourceLanguage}` : ''} into ${input.targetLanguage} using fluent, idiomatic target-language grammar. The target language label may be an English name, a native name or endonym, an ISO language code, or mildly misspelled; infer the intended language before translating. Preserve meaning, facts, tone, and useful structure. Trim leading and trailing whitespace, remove trailing spaces, collapse excessive blank lines, and organize longer content into readable sections with concise plain-text headings when the material supports them. Do not force headings into short content. ${input.preserveFormatting ? 'Preserve meaningful paragraph boundaries and formatting.' : 'Use clear, natural prose.'} Do not add Markdown decoration or commentary. ${input.instruction ? `Additional direction: ${input.instruction} ` : ''}Return only the translated text.`,
                messages: [{ role: 'user', content: [{ type: 'text', text: current.content }] }],
                options: { temperature: 0.1, maxTokens: Math.min(5_000, Math.max(256, Math.ceil(current.content.length / 3))) },
              }, current.key, current.scopeKey)).text)
                .replace(/^```(?:text)?\s*/i, '')
                .replace(/\s*```$/i, '')
                .replace(/\r\n?/g, '\n')
                .replace(/[ \t]+\n/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim()
              : await generated(current, instruction, tool === 'document.rewrite');
            const persistedDocumentKey = item.mode === 'replace'
              ? await persistGenerated(current, text, 'replace', tool.split('.')[1])
              : item.mode === 'copy'
                ? await persistGenerated(current, text, 'copy', tool.split('.')[1])
                : undefined;
            return {
              documentKey: current.key,
              text,
              ...(tool === 'document.translate' ? { language: input.targetLanguage } : {}),
              ...(persistedDocumentKey ? { persistedDocumentKey } : {}),
            };
          },
        })), false, repo);
    } else if (tool === 'content.neighbors') {
      const source = input.folderKey
        ? await folder(input.folderKey, 'viewer', false)
        : await document(input.documentKey!, 'viewer', false);
      if (!await activeFolderHierarchy(input.folderKey ? source.key : (source as Document).folderKey, source.scopeKey)) {
        fail('CONTENT_NOT_FOUND', 'The source folder hierarchy was not found.', tool, 'read', source.key);
      }
      const parsedEmbedding = z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS).safeParse(source.embedding);
      if (!parsedEmbedding.success) fail('CONTENT_CONFLICT', 'Semantic similarity is not ready for this resource.', tool, 'semantic-neighbors', source.key);
      if (!repo.semanticNeighbors) fail('CONTENT_CONFLICT', 'Semantic similarity is unavailable.', tool, 'semantic-neighbors', source.key);

      const allFolders = await repo.listFolders(source.scopeKey, true);
      const foldersByKey = new Map(allFolders.map((current) => [current.key, current]));
      const hierarchyIsActive = (folderKey: string) => {
        const visited = new Set<string>();
        let currentKey: string | undefined = folderKey;
        while (currentKey) {
          if (visited.has(currentKey)) return false;
          visited.add(currentKey);
          const current = foldersByKey.get(currentKey);
          if (!current || current._internalDeletion) return false;
          currentKey = current.parentFolderKey;
        }
        return true;
      };
      const activeFolderKeys = allFolders.filter((current) => hierarchyIsActive(current.key)).map((current) => current.key);
      const matches = await repo.semanticNeighbors({
        embedding: parsedEmbedding.data,
        scopeKey: source.scopeKey,
        activeFolderKeys,
        ...(input.folderKey ? { sourceFolderKey: input.folderKey } : { sourceDocumentKey: input.documentKey }),
        limit: 10,
      });
      const folders = matches.folders
        .filter(({ folder: current }) => current.scopeKey === source.scopeKey && current.key !== input.folderKey && activeFolderKeys.includes(current.key) && !current._internalDeletion)
        .slice(0, 10);
      const activeDocument = (current: Document) => current.scopeKey === source.scopeKey && current.key !== input.documentKey && !current._internalDeletion && (!current.folderKey || activeFolderKeys.includes(current.folderKey));
      const documents = matches.documents.filter(({ document: current }) => activeDocument(current) && !current.extension).slice(0, 10);
      const files = matches.files.filter(({ document: current }) => activeDocument(current) && Boolean(current.extension)).slice(0, 10);
      result = {
        folders: await Promise.all(folders.map(({ folder: current }) => folderView(current, d))),
        documents: documents.map(({ document: current }) => documentView(current)),
        files: files.map(({ document: current }) => documentView(current)),
      };
    } else if (tool === 'content.search-history.delete') {
      await roleFor(input.scopeKey, 'viewer');
      const history = dependencies.userSearches ?? (await import('@/lib/user-searches/service')).getDefaultUserSearchService();
      result = await history.remove(member.user.key, input.normalizedQuery);
    } else if (tool === 'content.search-history.list') {
      await roleFor(input.scopeKey, 'viewer');
      const history = dependencies.userSearches ?? (await import('@/lib/user-searches/service')).getDefaultUserSearchService();
      result = { history: await history.list(member.user.key, input.limit) };
    } else if (tool === 'content.search') {
      await roleFor(input.scopeKey, 'viewer');
      const allowed = await repo.allowedScopeKeys(context.organizationKey, member.userOrganization.key);
      if (!allowed.includes(input.scopeKey)) fail('CONTENT_FORBIDDEN', 'The principal lacks access to the requested scope.', tool, 'authorization', input.scopeKey);
      const normalizedQuery = input.query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
      const cacheVersion = CONTENT_SEARCH_CACHE_VERSION;
      const folderKey = input.folderKey ?? null;
      const includeDescendants = folderKey !== null && (input.includeDescendants ?? true);
      const store = dependencies.searchQueries ?? (await import('@/lib/db/content-search-queries.node')).contentSearchQueries;
      const history = dependencies.userSearches ?? (await import('@/lib/user-searches/service')).getDefaultUserSearchService();
      const recordSearch = async (output: unknown) => {
        await store.record({ key: d.id(), actorKey: member.user.key, scopeKey: input.scopeKey, query: input.query, normalizedQuery, folderKey, includeDescendants, cacheVersion, output, now: now() });
        if (input.recordHistory) await history.record(member.user.key, input.query);
      };
      const [allFolders, allDocuments] = await Promise.all([repo.listFolders(input.scopeKey), repo.listDocuments(input.scopeKey)]);
      let folderKeys: string[] | undefined;
      let revisionFolders = allFolders;
      if (folderKey) {
        const current = await folder(folderKey, 'viewer', false);
        if (current.scopeKey !== input.scopeKey) fail('CONTENT_FORBIDDEN', 'Folder does not belong to the requested scope.', tool, 'authorization', folderKey);
        folderKeys = [folderKey, ...(includeDescendants ? descendants(allFolders, folderKey).map((item) => item.key) : [])];
        const relevant = new Set(folderKeys);
        let ancestorKey = current.parentFolderKey;
        while (ancestorKey && !relevant.has(ancestorKey)) { relevant.add(ancestorKey); ancestorKey = allFolders.find((item) => item.key === ancestorKey)?.parentFolderKey; }
        revisionFolders = allFolders.filter((item) => relevant.has(item.key));
      }
      const revisionDocuments = folderKeys ? allDocuments.filter((item) => item.folderKey && folderKeys!.includes(item.folderKey)) : allDocuments;
      const folderRevision = revisionFolders.map((item) => `${item.key}:${item.parentFolderKey ?? ''}:${item.updatedAt}:${item.isFavorite ? 'favorite' : ''}:${item._internalDeletion ? 'pending' : ''}`);
      const documentRevision = revisionDocuments.map((item) => `${item.key}:${item.name}:${item.folderKey ?? ''}:${item.semanticContentHash ?? ''}:${item.isFavorite ? 'favorite' : ''}:${item._internalDeletion ? 'pending' : ''}`);
      const sourceRevision = createHash('sha256').update([...folderRevision, ...documentRevision].sort().join('\n')).digest('hex');
      const cached = await store.get({ actorKey: member.user.key, scopeKey: input.scopeKey, normalizedQuery, folderKey, includeDescendants, cacheVersion });
      const cachedValue = cached?.output as { result?: unknown; sourceRevision?: string; minimumScore?: number; includeSummaries?: boolean; replayable?: boolean } | undefined;
      const reusable = Boolean(cachedValue?.replayable && cachedValue.result && cachedValue.sourceRevision === sourceRevision && cachedValue.minimumScore === input.minimumScore && cachedValue.includeSummaries === input.includeSummaries);
      if (reusable) {
        const parsed = contentToolOutputSchemas[tool].parse({ ...(cachedValue!.result as object), query: input.query, cached: true });
        await recordSearch(cachedValue);
        result = parsed;
      } else if (!input.includeSummaries) {
        const queryText = normalizedQuery;
        const queryTokens = new Set<string>(queryText.match(/[\p{L}\p{N}]+/gu) ?? []);
        const scoreText = (value: string) => {
          const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US');
          if (normalized.includes(queryText)) return 0.75;
          const tokens = new Set<string>(normalized.match(/[\p{L}\p{N}]+/gu) ?? []);
          const matched = [...queryTokens].filter((token) => tokens.has(token)).length;
          return matched > 0 ? 0.4 + 0.3 * (matched / Math.max(queryTokens.size, 1)) : 0;
        };
        const activeFolders = [];
        for (const current of allFolders) {
          if (folderKeys && !folderKeys.includes(current.key)) continue;
          if (current._internalDeletion || !await activeFolderHierarchy(current.key, current.scopeKey)) continue;
          const score = scoreText(`${current.name}\n${current.description ?? ''}`);
          if (score >= input.minimumScore) activeFolders.push({ folder: current, score });
        }
        const activeDocuments = [];
        for (const current of allDocuments) {
          if (folderKeys && (!current.folderKey || !folderKeys.includes(current.folderKey))) continue;
          if (current._internalDeletion || !await activeFolderHierarchy(current.folderKey, current.scopeKey)) continue;
          const score = scoreText(`${current.name}\n${current.content}`);
          if (score >= input.minimumScore) activeDocuments.push({ document: current, score });
        }
        const hasExactMatch = activeFolders.some(({ score }) => score >= 0.75) || activeDocuments.some(({ score }) => score >= 0.75);
        if (!hasExactMatch) {
          let embeddingTimer: number | undefined;
          const queryEmbedding = await Promise.race<number[] | undefined>([
            embed(input.query, undefined, input.scopeKey, 'query').catch(() => undefined),
            new Promise<undefined>((resolve) => { embeddingTimer = setTimeout(resolve, dependencies.searchEmbeddingTimeoutMs ?? 500); }),
          ]);
          if (embeddingTimer) clearTimeout(embeddingTimer);
          if (queryEmbedding) {
            const [documentMatches, folderMatches] = await Promise.all([
              repo.semanticSearch({ embedding: queryEmbedding, authorizedScopeKeys: [input.scopeKey], ...(folderKeys ? { folderKeys } : {}), minScore: input.minimumScore, limit: 40 }),
              repo.semanticSearchFolders?.({ embedding: queryEmbedding, authorizedScopeKeys: [input.scopeKey], ...(folderKeys ? { folderKeys } : {}), minScore: input.minimumScore, limit: 20 }) ?? [],
            ]);
            for (const match of folderMatches) {
              if (match.folder.scopeKey !== input.scopeKey || folderKeys && !folderKeys.includes(match.folder.key) || match.folder._internalDeletion || !await activeFolderHierarchy(match.folder.key, match.folder.scopeKey)) continue;
              const previous = activeFolders.find(({ folder: current }) => current.key === match.folder.key);
              if (previous) previous.score = Math.max(previous.score, match.score);
              else activeFolders.push(match);
            }
            for (const match of documentMatches) {
              if (match.document.scopeKey !== input.scopeKey || folderKeys && (!match.document.folderKey || !folderKeys.includes(match.document.folderKey)) || match.document._internalDeletion || !await activeFolderHierarchy(match.document.folderKey, match.document.scopeKey)) continue;
              const previous = activeDocuments.find(({ document: current }) => current.key === match.document.key);
              if (previous) previous.score = Math.max(previous.score, match.score);
              else activeDocuments.push(match);
            }
          }
        }
        const folders = activeFolders.sort((left, right) => right.score - left.score || left.folder.key.localeCompare(right.folder.key)).slice(0, 4).map(({ folder: current, score }) => ({ key: current.key, scopeKey: current.scopeKey, ...(current.parentFolderKey ? { parentFolderKey: current.parentFolderKey } : {}), name: current.name, ...(current.description ? { description: current.description } : {}), isFavorite: Boolean(current.isFavorite), score: Math.max(0, Math.min(1, score)) }));
        const documents = activeDocuments.sort((left, right) => right.score - left.score || left.document.key.localeCompare(right.document.key)).slice(0, 10).map(({ document: current, score }) => ({ documentKey: current.key, scopeKey: current.scopeKey, ...(current.folderKey ? { folderKey: current.folderKey } : {}), name: current.name, ...(current.extension ? { extension: current.extension } : {}), isFavorite: Boolean(current.isFavorite), score: Math.max(0, Math.min(1, score)) }));
        const freshResult = { query: input.query, folders, documents, cached: false };
        await recordSearch({ result: freshResult, sourceRevision, minimumScore: input.minimumScore, includeSummaries: false, replayable: true });
        result = freshResult;
      } else {
        let queryEmbedding: number[];
        try { queryEmbedding = await embed(input.query, undefined, input.scopeKey, 'query'); }
        catch (error) { fail('CONTENT_SEARCH_EMBEDDING_FAILED', 'Search query embedding failed.', tool, 'embed', undefined, error, true); }
        const [documentMatches, folderMatches] = await Promise.all([
          repo.semanticSearch({ embedding: queryEmbedding, authorizedScopeKeys: [input.scopeKey], ...(folderKeys ? { folderKeys } : {}), minScore: input.minimumScore, limit: 100 }),
          repo.semanticSearchFolders?.({ embedding: queryEmbedding, authorizedScopeKeys: [input.scopeKey], ...(folderKeys ? { folderKeys } : {}), minScore: input.minimumScore, limit: 20 }) ?? [],
        ]);
        const folders = [];
        for (const match of folderMatches) {
          if (match.score < input.minimumScore || match.folder.scopeKey !== input.scopeKey || folderKeys && !folderKeys.includes(match.folder.key) || match.folder._internalDeletion || !await activeFolderHierarchy(match.folder.key, match.folder.scopeKey)) continue;
          folders.push({ key: match.folder.key, scopeKey: match.folder.scopeKey, ...(match.folder.parentFolderKey ? { parentFolderKey: match.folder.parentFolderKey } : {}), name: match.folder.name, ...(match.folder.description ? { description: match.folder.description } : {}), isFavorite: Boolean(match.folder.isFavorite), score: Math.max(0, Math.min(1, match.score)) });
          if (folders.length === 4) break;
        }
        const selectedDocuments = [];
        for (const match of documentMatches) {
          if (match.score >= input.minimumScore && match.document.scopeKey === input.scopeKey && (!folderKeys || match.document.folderKey !== undefined && folderKeys.includes(match.document.folderKey)) && !match.document._internalDeletion && await activeFolderHierarchy(match.document.folderKey, match.document.scopeKey)) selectedDocuments.push(match);
          if (selectedDocuments.length === 10) break;
        }
        const documents = [];
        let summariesComplete = true;
        for (let start = 0; start < selectedDocuments.length; start += 3) {
          const batch = await Promise.all(selectedDocuments.slice(start, start + 3).map(async ({ document: current, matchedContent, score }) => {
            let summary: string;
            let complete = true;
            try {
              const generatedSummary = await action('reason', {
                systemPrompt: 'Summarize only how the supplied document relates to the search query. Use only the supplied text and return only the concise summary without commentary.',
                messages: [{ role: 'user', content: [{ type: 'text', text: `Search query: ${input.query}\n\nTitle: ${current.name}\n\n${(matchedContent ?? current.content).slice(0, 16_000)}` }] }],
                options: { temperature: 0.1, maxTokens: 300 },
              }, current.key, current.scopeKey);
              summary = z.string().trim().min(1).parse(generatedSummary.text);
            } catch {
              complete = false;
              summary = `This document contains semantically relevant information for "${input.query}".`;
            }
            return { complete, document: { documentKey: current.key, scopeKey: current.scopeKey, ...(current.folderKey ? { folderKey: current.folderKey } : {}), name: current.name, ...(current.extension ? { extension: current.extension } : {}), isFavorite: Boolean(current.isFavorite), score: Math.max(0, Math.min(1, score)), summary } };
          }));
          summariesComplete &&= batch.every(({ complete }) => complete);
          documents.push(...batch.map(({ document }) => document));
        }
        const freshResult = { query: input.query, folders, documents, cached: false };
        await recordSearch({ result: freshResult, sourceRevision, minimumScore: input.minimumScore, includeSummaries: true, replayable: summariesComplete });
        result = freshResult;
      }
    } else {
      const organizationSearch = tool === 'document.search-all';
      if (organizationSearch && input.organizationKey !== context.organizationKey) fail('CONTENT_FORBIDDEN', 'Organization key does not match the execution context.', tool, 'authorization');
      const allowed = await repo.allowedScopeKeys(context.organizationKey, member.userOrganization.key);
      if (!organizationSearch) await roleFor(input.scopeKey, 'viewer');

      const filterScopeKeys = new Set<string>(input.filters?.scopeKeys ?? allowed);
      const filterFolderKeys: string[] | undefined = input.filters?.folderKeys;
      if (filterFolderKeys) {
        for (const key of filterFolderKeys) await folder(key, 'viewer');
      }
      const sourceInputs = input.sources ?? [{ type: 'scope', scopeKeys: organizationSearch ? allowed : [input.scopeKey] }];
      const resolvedSources: Array<{ type: 'scope' | 'folder'; key: string; scopeKeys: string[]; folderKeys?: string[] }> = [];
      for (const source of sourceInputs) {
        if (source.type === 'scope') {
          for (const key of source.scopeKeys) resolvedSources.push({ type: 'scope', key, scopeKeys: [key] });
        } else {
          for (const key of source.folderKeys) {
            const current = await folder(key, 'viewer');
            if (!await activeFolderHierarchy(key, current.scopeKey)) fail('CONTENT_NOT_FOUND', 'Search folder hierarchy was not found.', tool, 'resolution', key);
            const children = source.includeDescendants ? descendants(await foldersIn(current.scopeKey), key) : [];
            const folderKeys = [key, ...children.map((item) => item.key)];
            resolvedSources.push({ type: 'folder', key, scopeKeys: [current.scopeKey], folderKeys });
          }
        }
      }
      const queryText = input.query.trim().toLocaleLowerCase();
      const queryTokens = [...new Set<string>(queryText.match(/[\p{L}\p{N}]+/gu) ?? [])];
      const documentsByScope = new Map<string, Document[]>();
      const lexicalMatches = async (scopeKeys: string[], folderKeys?: string[]) => {
        const documents = (await Promise.all(scopeKeys.map(async (scopeKey) => {
          let values = documentsByScope.get(scopeKey);
          if (!values) {
            values = await repo.listDocuments(scopeKey);
            documentsByScope.set(scopeKey, values);
          }
          return values;
        }))).flat();
        return documents.flatMap((document) => {
          if (document._internalDeletion) return [];
          if (folderKeys && (!document.folderKey || !folderKeys.includes(document.folderKey))) return [];
          if (input.filters?.documentKeys && !input.filters.documentKeys.includes(document.key)) return [];
          if (input.filters?.extensions && (!document.extension || !input.filters.extensions.includes(document.extension))) return [];
          if (input.filters?.createdAfter && document.createdAt < input.filters.createdAfter) return [];
          if (input.filters?.createdBefore && document.createdAt > input.filters.createdBefore) return [];
          if (input.filters?.updatedAfter && document.updatedAt < input.filters.updatedAfter) return [];
          if (input.filters?.updatedBefore && document.updatedAt > input.filters.updatedBefore) return [];
          const searchable = `${document.name}\n${document.content}`.toLocaleLowerCase();
          const documentTokens = new Set(searchable.match(/[\p{L}\p{N}]+/gu) ?? []);
          const matchedTokens = queryTokens.filter((token) => documentTokens.has(token));
          const exactMatch = searchable.includes(queryText);
          if (!exactMatch && matchedTokens.length === 0) return [];
          const score = exactMatch ? 0.75 : 0.4 + 0.3 * (matchedTokens.length / Math.max(queryTokens.length, 1));
          if (input.minimumScore !== undefined && score < input.minimumScore) return [];
          const contentText = document.content.toLocaleLowerCase();
          const contentMatchAt = contentText.indexOf(exactMatch ? queryText : matchedTokens[0]!);
          const matchAt = Math.max(0, contentMatchAt - 80);
          return [{ score, document, matchedContent: document.content.slice(matchAt, matchAt + 300) }];
        });
      };
      const candidates = new Map<string, { score: number; document: Document; matchedContent?: string; source: { type: 'scope' | 'folder'; key: string } }>();
      const searchableSources: Array<{ source: (typeof resolvedSources)[number]; scopeKeys: string[]; folderKeys?: string[] }> = [];
      for (const source of resolvedSources) {
        const scopeKeys = source.scopeKeys.filter((key) => allowed.includes(key) && filterScopeKeys.has(key));
        if (scopeKeys.length === 0) continue;
        let folderKeys = source.folderKeys;
        if (filterFolderKeys) folderKeys = folderKeys ? folderKeys.filter((key) => filterFolderKeys.includes(key)) : filterFolderKeys;
        if (folderKeys?.length === 0) continue;
        searchableSources.push({ source, scopeKeys, ...(folderKeys ? { folderKeys } : {}) });
      }
      const collectMatches = async (matches: Array<{ score: number; document: Document; matchedContent?: string }>, source: (typeof resolvedSources)[number]) => {
        for (const match of matches) {
          if (match.document._internalDeletion) continue;
          if (!await activeFolderHierarchy(match.document.folderKey, match.document.scopeKey)) continue;
          const previous = candidates.get(match.document.key);
          if (!previous || match.score > previous.score) candidates.set(match.document.key, { ...match, source: { type: source.type, key: source.key } });
        }
      };
      for (const { source, scopeKeys, folderKeys } of searchableSources) {
        await collectMatches(await lexicalMatches(scopeKeys, folderKeys), source);
      }
      const exactFolderMatches = searchableSources.length > 0
        && searchableSources.every(({ source }) => source.type === 'folder')
        && [...candidates.values()].some(({ score }) => score >= 0.75);
      if (!exactFolderMatches) {
        let embeddingTimer: number | undefined;
        const embedding = await Promise.race<number[] | undefined>([
          embed(input.query, undefined, undefined, 'query').catch(() => undefined),
          new Promise<undefined>((resolve) => { embeddingTimer = setTimeout(resolve, dependencies.searchEmbeddingTimeoutMs ?? 500); }),
        ]);
        if (embeddingTimer) clearTimeout(embeddingTimer);
        if (embedding) for (const { source, scopeKeys, folderKeys } of searchableSources) {
          await collectMatches(await repo.semanticSearch({
            embedding,
            authorizedScopeKeys: scopeKeys,
            folderKeys,
            documentKeys: input.filters?.documentKeys,
            extensions: input.filters?.extensions,
            createdAfter: input.filters?.createdAfter,
            createdBefore: input.filters?.createdBefore,
            updatedAfter: input.filters?.updatedAfter,
            updatedBefore: input.filters?.updatedBefore,
            minScore: input.minimumScore,
            limit: input.topK ?? 20,
          }), source);
        }
      }
      if (resolvedSources.length === 0 || candidates.size === 0 && !resolvedSources.some((source) => source.scopeKeys.some((key) => allowed.includes(key)))) fail('CONTENT_SEARCH_NO_ACCESSIBLE_SOURCES', 'No accessible Content search source remains.', tool, 'authorization');
      const ranked = [...candidates.values()].sort((left, right) => right.score - left.score || left.document.key.localeCompare(right.document.key));
      const totalCandidates = ranked.length;
      const selected = ranked.slice(0, input.topK ?? 20);
      result = {
        query: input.query,
        results: await Promise.all(selected.map(async ({ score, document: current, matchedContent, source }) => {
          const normalizedScore = Math.max(0, Math.min(1, score));
          const parent = input.include?.includes('folder') && current.folderKey ? await repo.getFolder(current.folderKey) : undefined;
          return {
            documentKey: current.key,
            name: current.name,
            ...(current.extension ? { extension: current.extension } : {}),
            scopeKey: current.scopeKey,
            ...(current.folderKey ? { folderKey: current.folderKey } : {}),
            score: normalizedScore,
            matchedSource: source,
            ...(input.include?.includes('snippet') ? { snippet: (matchedContent ?? current.content).slice(0, 300) } : {}),
            ...(input.include?.includes('content') ? { content: current.content } : {}),
            ...(parent ? { folder: await folderView(parent, d) } : {}),
            ...(input.include?.includes('scope') ? { scope: { key: current.scopeKey } } : {}),
            ...(input.include?.includes('scoreBreakdown') ? { scoreBreakdown: { vector: normalizedScore, final: normalizedScore } } : {}),
          };
        })),
        totalCandidates,
      };
    }
    const parsed = contentToolOutputSchemas[tool].parse(result) as ContentToolOutput<Name>;
    executionCompleted = true;
    if (idempotencyIdentity && requestHash && ownsIdempotencyClaim) await d.idempotency.complete(idempotencyIdentity, requestHash, invocationKey, parsed, now());
    await event('action', 'succeeded', 'tool', undefined, context.runtimeScopeKey, Math.round(performance.now() - invocationStarted));
    return parsed;
  } catch (error) {
    const mapped = mappedError(error, tool);
    if (idempotencyIdentity && requestHash && ownsIdempotencyClaim && !executionCompleted) await d.idempotency.release(idempotencyIdentity, requestHash, invocationKey).catch(() => undefined);
    await event('action', 'failed', 'tool', mapped.resourceKey, context.runtimeScopeKey, Math.round(performance.now() - invocationStarted));
    throw mapped;
  }
}
