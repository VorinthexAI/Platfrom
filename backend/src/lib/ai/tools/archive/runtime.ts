import { createHash, randomBytes, scrypt as nodeScrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { DomainToolContext } from '@/lib/ai/domain-tools/execute';
import type { DocumentProcessingDependencies, DocumentProcessingInput } from '@/lib/ai/document-processing';
import type { RouterDependencies } from '@/lib/ai/router';
import type { DocumentObjectStorage } from '@/lib/ai/document-processing/storage';
import type { Folder } from '@/lib/db/folders.node';
import type { Document } from '@/lib/db/documents.node';
import type { DocumentShare } from '@/lib/db/document-shares.node';
import { documentVersionSchema, type DocumentVersion } from '@/lib/db/document-versions.node';
import { DocumentProcessingError } from '@/lib/ai/document-processing/errors';
import { editorDocumentJsonSchema } from '@/lib/ai/document-processing/schemas';
import type { generateDocumentExport } from '@/lib/ai/document-processing/exports';
import type { ArchiveToolName, ArchiveToolOutput } from './schemas';
import { ArchiveError, type ArchiveErrorCode } from './errors';
import { archiveToolInputSchemas, archiveToolOutputSchemas, isArchiveToolName } from './registry';

type Role = 'viewer' | 'moderator' | 'admin' | 'owner';
type Action = 'read' | 'traverse' | 'insert' | 'update' | 'delete' | 'embed' | 'speak' | 'reason' | 'deep-reason' | 'document-generate-html' | 'document-generate-json' | 'document-generate-content' | 'document-embed';
type SafeEvent = {
  type: 'authorization' | 'resolution' | 'action' | 'db' | 'embedding' | 'storage' | 'speech' | 'cleanup' | 'audit';
  status: 'started' | 'succeeded' | 'failed';
  tool: ArchiveToolName;
  invocationKey: string;
  action?: string;
  resourceKey?: string;
  scopeKey?: string;
  retryable?: boolean;
  durationMs?: number;
};

export interface ArchiveIdempotencyStore {
  claim(identity: { organizationKey: string; actorKey: string; tool: string; idempotencyKey: string }, requestHash: string, leaseOwner: string, now: string): Promise<{ status: 'claimed' } | { status: 'pending' } | { status: 'conflict' } | { status: 'replay'; response: unknown }>;
  complete(identity: { organizationKey: string; actorKey: string; tool: string; idempotencyKey: string }, requestHash: string, leaseOwner: string, response: unknown, now: string): Promise<void>;
  release(identity: { organizationKey: string; actorKey: string; tool: string; idempotencyKey: string }, requestHash: string, leaseOwner: string): Promise<void>;
}

export interface ArchiveRepository {
  getScope(scopeKey: string): Promise<{ key: string; organizationKey: string; deletedAt?: string | null } | null>;
  role(scopeKey: string, membershipKey: string): Promise<Role | null>;
  allowedScopeKeys(organizationKey: string, membershipKey: string): Promise<string[]>;
  getFolder(key: string): Promise<Folder | null>;
  listFolders(scopeKey: string, includeArchived?: boolean, includePendingDeletion?: boolean): Promise<Folder[]>;
  insertFolder(folder: Folder): Promise<Folder>;
  updateFolder(key: string, patch: Partial<Folder>): Promise<Folder>;
  setFolderDeletion(key: string, marker: Folder['_internalDeletion'] | undefined, owner?: string): Promise<Folder | null>;
  deleteFolder(key: string): Promise<void>;
  getDocument(key: string): Promise<Document | null>;
  listDocuments(scopeKey: string, includeArchived?: boolean, includePendingDeletion?: boolean): Promise<Document[]>;
  insertDocument(document: Document): Promise<Document>;
  updateDocument(key: string, patch: Partial<Document>): Promise<Document>;
  setDocumentDeletion(key: string, marker: Document['_internalDeletion'] | undefined, owner?: string): Promise<Document | null>;
  deleteDocument(key: string): Promise<void>;
  getShare(key: string): Promise<DocumentShare | null>;
  listShares(scopeKey: string, documentKeys: string[], options?: { includeArchived?: boolean; includeExpired?: boolean; includeRevoked?: boolean; at?: string }): Promise<DocumentShare[]>;
  insertShare(share: Omit<DocumentShare, 'embedding' | 'deletedAt'>): Promise<DocumentShare>;
  updateShare(key: string, patch: Partial<DocumentShare>): Promise<DocumentShare>;
  deleteShare(key: string): Promise<void>;
  getVersion(key: string): Promise<DocumentVersion | null>;
  listVersions(scopeKey: string, documentKeys: string[], includeArchived?: boolean): Promise<DocumentVersion[]>;
  createVersion(version: Omit<DocumentVersion, 'key' | 'version' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<DocumentVersion>;
  deleteVersion(key: string): Promise<void>;
  semanticSearch(input: { embedding: number[]; authorizedScopeKeys: string[]; folderKeys?: string[]; documentKeys?: string[]; extensions?: Document['extension'][]; createdAfter?: string; createdBefore?: string; updatedAfter?: string; updatedBefore?: string; includeArchived?: boolean; minScore?: number; limit?: number }): Promise<Array<{ score: number; document: Document }>>;
  transaction?<T>(operation: (repository: ArchiveRepository) => Promise<T>): Promise<T>;
}

export interface ArchiveActionResult { text?: string; audio?: Uint8Array; mimeType?: string; durationMs?: number; html?: string; json?: Document['json']; content?: string; embedding?: number[] }
export interface ArchiveToolDependencies extends RouterDependencies {
  repository?: ArchiveRepository;
  storage?: DocumentObjectStorage;
  processDocument?: (input: DocumentProcessingInput, dependencies?: DocumentProcessingDependencies) => Promise<{ document: Document }>;
  runAction?: (action: Action, input: Record<string, unknown>, context: DomainToolContext) => Promise<ArchiveActionResult>;
  embed?: (text: string) => Promise<number[]>;
  observer?: (event: SafeEvent) => void | Promise<void>;
  audit?: (event: { tool: ArchiveToolName; success: boolean; organizationKey: string; scopeKey: string; actorKey: string; resourceKeys: string[]; code?: string }) => Promise<void>;
  clock?: () => Date;
  id?: () => string;
  random?: (size: number) => Uint8Array;
  canPermanentlyDelete?: (input: { kind: 'folder' | 'document' | 'version'; deletedAt?: string | null; context: DomainToolContext }) => boolean | Promise<boolean>;
  projectScopeKeys?: (projectKeys: string[], organizationKey: string) => Promise<Record<string, string>>;
  maxSpeechChunkCharacters?: number;
  ingestion?: DocumentProcessingDependencies;
  idempotency?: ArchiveIdempotencyStore;
  maxDownloadBytes?: number;
  generateExport?: typeof generateDocumentExport;
}

const rank: Record<Role, number> = { viewer: 1, moderator: 2, admin: 3, owner: 4 };
const scrypt = promisify(nodeScrypt);
const MUTATIONS = new Set<ArchiveToolName>([
  'folder.create', 'folder.update', 'folder.rename', 'folder.move', 'folder.archive', 'folder.restore', 'folder.delete', 'document.processing', 'document.update', 'document.rename', 'document.move', 'document.copy', 'document.archive', 'document.restore', 'document.delete', 'document.share', 'document.unshare', 'document.create-version', 'document.restore-version', 'document.delete-version', 'document.summarize', 'document.translate', 'document.rewrite',
]);

function fail(code: ArchiveErrorCode, message: string, tool: ArchiveToolName, action?: string, resourceKey?: string, cause?: unknown, retryable = false): never {
  throw new ArchiveError(code, message, tool, { action, resourceKey, cause, retryable });
}

function mappedError(error: unknown, tool: ArchiveToolName, action?: string, resourceKey?: string): ArchiveError {
  if (error instanceof ArchiveError) return error;
  if (error instanceof DocumentProcessingError) {
    const codeByAction: Partial<Record<string, ArchiveErrorCode>> = {
      'document-validate': error.code === 'DOCUMENT_TOO_LARGE' ? 'DOCUMENT_TOO_LARGE' : error.code === 'DOCUMENT_INVALID_MIME_TYPE' ? 'DOCUMENT_INVALID_MIME_TYPE' : 'DOCUMENT_UNSUPPORTED_TYPE',
      'document-extract': 'DOCUMENT_EXTRACTION_FAILED',
      'document-embed': 'DOCUMENT_EMBEDDING_FAILED',
      'document-insert': 'DOCUMENT_INSERT_FAILED',
    };
    return new ArchiveError(codeByAction[error.action] ?? 'DOCUMENT_PROCESSING_FAILED', error.message, tool, {
      action: error.action,
      resourceKey,
      retryable: error.retryable,
    });
  }
  const validation = error && typeof error === 'object' && ('issues' in error || ('name' in error && error.name === 'ZodError'));
  return new ArchiveError(validation ? 'ARCHIVE_INVALID_INPUT' : 'ARCHIVE_CONFLICT', validation ? 'Archive tool input or output was invalid.' : 'Archive operation failed.', tool, { action, resourceKey, cause: error, retryable: !validation });
}

function folderView(folder: Folder) {
  const { embedding: _embedding, _internalDeletion: _internalDeletion, ...safe } = folder;
  return safe;
}

function documentView(document: Document) {
  const { html: _html, json: _json, content: _content, embedding: _embedding, storageKey: _storageKey, speechStorageKeys: _speechStorageKeys, _internalDeletion: _internalDeletion, ...safe } = document;
  return safe;
}

function shareView(share: DocumentShare) {
  const { tokenHash: _tokenHash, passwordHash: _passwordHash, embedding: _embedding, ...safe } = share;
  return safe;
}

function versionView(version: DocumentVersion, include: string[] = []) {
  const { embedding, html, json, content, ...safe } = version;
  return { ...safe, ...(include.includes('html') ? { html } : {}), ...(include.includes('json') ? { json } : {}), ...(include.includes('content') ? { content } : {}), ...(include.includes('embedding') ? { embedding } : {}) };
}

async function productionRepository(): Promise<ArchiveRepository> {
  const [documents, client, scopes, archive] = await Promise.all([
    import('@/lib/db/documents.node'),
    import('@/lib/db/client'),
    import('@/lib/ai/scopes/repository'),
    import('@/lib/db/archive-persistence.node'),
  ]);
  const scopeRepository = scopes.createScopeRepository();
  const role = async (scopeKey: string, membershipKey: string): Promise<Role | null> => {
    const cursor = await client.db.query<{ members: Array<{ scopeKey: string; role: Role }>; relations: Array<{ parentKey: string; childKey: string }> }>(
      'RETURN { members: (FOR member IN scopeMembers FILTER member.userOrganizationKey == @membershipKey && member.status == "active" RETURN { scopeKey: member.scopeKey, role: member.role }), relations: (FOR relation IN scopeScopes FILTER relation.deletedAt == null RETURN { parentKey: relation.parentKey, childKey: relation.childKey }) }',
      { membershipKey },
    );
    const data = await cursor.next();
    const parentByChild = new Map((data?.relations ?? []).map((relation) => [relation.childKey, relation.parentKey]));
    const ancestors = new Set([scopeKey]);
    let current = parentByChild.get(scopeKey);
    while (current && !ancestors.has(current)) { ancestors.add(current); current = parentByChild.get(current); }
    return (data?.members ?? []).filter((item) => ancestors.has(item.scopeKey)).sort((a, b) => rank[b.role] - rank[a.role])[0]?.role ?? null;
  };
  const allowedScopeKeys = async (organizationKey: string, membershipKey: string): Promise<string[]> => {
    const cursor = await client.db.query<{ orgRole?: string; scopes: string[]; members: string[]; relations: Array<{ parentKey: string; childKey: string }> }>(
      'LET membership = DOCUMENT(userOrganizations, @membershipKey) RETURN { orgRole: membership.orgRole, scopes: (FOR scope IN scopes FILTER scope.organizationKey == @organizationKey && scope.deletedAt == null RETURN scope._key), members: (FOR member IN scopeMembers FILTER member.userOrganizationKey == @membershipKey && member.status == "active" RETURN member.scopeKey), relations: (FOR relation IN scopeScopes FILTER relation.deletedAt == null RETURN { parentKey: relation.parentKey, childKey: relation.childKey }) }',
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

  type Persistence = ReturnType<typeof archive.createArchivePersistence>;
  const makeRepository = (persistence: Persistence): ArchiveRepository => ({
    async getScope(key) { return scopeRepository.getScopeByKey(key); },
    role,
    allowedScopeKeys,
    getFolder: persistence.getFolder,
    async listFolders(scopeKey, includeArchived, includePendingDeletion) { return persistence.listFolders(scopeKey, includeArchived, includePendingDeletion); },
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
    async listDocuments(scopeKey, includeArchived, includePendingDeletion) { return persistence.listDocuments(scopeKey, includeArchived, includePendingDeletion); },
    insertDocument: persistence.insertDocument,
    async updateDocument(key, patch) {
      const current = await persistence.getDocument(key);
      if (!current) throw new Error('Document was not found for scoped update.');
      const updated = await persistence.updateDocument(current.scopeKey, key, patch);
      if (!updated) throw new Error('Document scope changed during update.');
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
      const values = await persistence.listShares(scopeKey, documentKeys);
      const at = options?.at ?? new Date().toISOString();
      return values.filter((share) => (options?.includeArchived || !share.deletedAt) && (options?.includeRevoked || !share.revokedAt) && (options?.includeExpired || !share.expiresAt || share.expiresAt > at));
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
    async listVersions(scopeKey, documentKeys, includeArchived) {
      const values = await persistence.listVersions(scopeKey, documentKeys);
      return values.filter((version) => includeArchived || !version.deletedAt);
    },
    createVersion: persistence.createVersion,
    async deleteVersion(key) {
      const current = await persistence.getVersion(key);
      if (!current || !await persistence.deleteVersion(current.scopeKey, key)) throw new Error('Version was not found for scoped deletion.');
    },
    semanticSearch: documents.semanticSearchDocuments,
    transaction: (operation) => archive.withArchivePersistenceTransaction((bound) => operation(makeRepository(bound))),
  });
  return makeRepository(archive.archivePersistence);
}

interface RuntimeDefaults {
  repository: ArchiveRepository;
  storage: DocumentObjectStorage;
  processDocument: NonNullable<ArchiveToolDependencies['processDocument']>;
  id: () => string;
  clock: () => Date;
  random: (size: number) => Uint8Array;
  embed: (text: string) => Promise<number[]>;
  runAction: NonNullable<ArchiveToolDependencies['runAction']>;
  idempotency: ArchiveIdempotencyStore;
  audit: NonNullable<ArchiveToolDependencies['audit']>;
  generateExport: typeof generateDocumentExport;
}

async function defaults(deps: ArchiveToolDependencies, context: DomainToolContext): Promise<RuntimeDefaults> {
  const [{ newId }, storage, processing, titan, router, ledger, events, exports] = await Promise.all([
    import('@/lib/ids'),
    import('@/lib/ai/document-processing/storage'),
    import('@/lib/ai/document-processing'),
    import('@/lib/bedrock-titan'),
    import('@/lib/ai/router'),
    import('@/lib/db/archive-idempotency.node'),
    import('@/lib/db/events.node'),
    import('@/lib/ai/document-processing/exports'),
  ]);
  const embedding = deps.embed ? (text: string) => deps.embed!(text) : (text: string) => titan.embedText({ text });
  return {
    repository: deps.repository ?? await productionRepository(), storage: deps.storage ?? storage.documentStorage,
    processDocument: deps.processDocument ?? processing.processDocument, id: deps.id ?? newId, clock: deps.clock ?? (() => new Date()), random: deps.random ?? randomBytes,
    embed: embedding,
    runAction: deps.runAction ?? (async (action: Action, input: Record<string, unknown>): Promise<ArchiveActionResult> => {
      if (action === 'document-generate-html') return processing.documentGenerateHtml(input as never) as Promise<ArchiveActionResult>;
      if (action === 'document-generate-json') return processing.documentGenerateJson(input as never) as Promise<ArchiveActionResult>;
      if (action === 'document-generate-content') return processing.documentGenerateContent(input as never) as Promise<ArchiveActionResult>;
      if (action === 'document-embed') return processing.documentEmbed(input as never, { embed: ({ text }) => embedding(text), dimensions: deps.ingestion?.embeddingDimensions }) as Promise<ArchiveActionResult>;
      const response = await router.executeAction<Record<string, unknown>, ArchiveActionResult>({ mode: 'auto', organizationKey: context.organizationKey, actionSlug: action as never }, input, deps);
      return response.output;
    }),
    idempotency: deps.idempotency ?? {
      claim: ledger.claimArchiveIdempotency,
      complete: ledger.completeArchiveIdempotency,
      release: ledger.releaseArchiveIdempotency,
    },
    audit: deps.audit ?? (async (audit) => {
      await events.insertEvent({
        key: newId(),
        scopeId: audit.scopeKey,
        userId: audit.actorKey,
        slug: `archive.${audit.tool}.${audit.success ? 'succeeded' : 'failed'}`,
        data: { resourceKeys: audit.resourceKeys, ...(audit.code ? { code: audit.code } : {}) },
        createdAt: new Date().toISOString(),
      });
    }),
    generateExport: deps.generateExport ?? exports.generateDocumentExport,
  };
}

function principal(context: DomainToolContext, tool: ArchiveToolName) {
  if (context.principal.kind !== 'member') fail('ARCHIVE_UNAUTHORIZED', 'A resolved human principal is required.', tool, 'authorization');
  const member = context.principal;
  if (member.userOrganization.organizationId !== context.organizationKey || member.userOrganization.status !== 'active') fail('ARCHIVE_FORBIDDEN', 'Active membership in the requested organization is required.', tool, 'authorization');
  return member;
}

async function observe(deps: ArchiveToolDependencies, event: SafeEvent) { try { await deps.observer?.(event); } catch { /* Telemetry cannot alter behavior. */ } }

async function batch<T>(tool: ArchiveToolName, items: Array<{ key: string; run: (repository: ArchiveRepository) => Promise<T>; preflight?: () => Promise<void> }>, atomic: boolean, initialRepository: ArchiveRepository) {
  let repo = initialRepository;
  if (atomic && !repo.transaction) fail('ARCHIVE_CONFLICT', 'Atomic mode is unavailable for this operation.', tool, 'transaction');
  if (atomic) for (const item of items) await item.preflight?.();
  const execute = async () => {
    const results: unknown[] = [];
    for (const item of items) {
      try { if (!atomic) await item.preflight?.(); results.push({ key: item.key, success: true, data: await item.run(repo) }); }
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

export function isArchiveMutation(tool: ArchiveToolName, input: any): boolean {
  if (tool === 'document.read') return input.mode === 'audio' && input.persistAudio === true;
  if (tool === 'document.summarize') return input.persist === true;
  if (tool === 'document.translate') return input.mode !== 'preview';
  if (tool === 'document.rewrite') return Array.isArray(input?.rewrites) && input.rewrites.some((item: any) => item?.mode !== 'preview');
  return MUTATIONS.has(tool);
}

function speechChunks(raw: string, includeCode: boolean, maximum: number) {
  const masked = includeCode ? raw : raw
    .replace(/```[\s\S]*?```/g, (value) => ' '.repeat(value.length))
    .replace(/`[^`]+`/g, (value) => ' '.repeat(value.length));
  const chunks: Array<{ text: string; start: number; end: number }> = [];
  for (const match of masked.matchAll(/\S[\s\S]*?(?=\n{2,}|$)/g)) {
    const block = match[0];
    const blockStart = match.index;
    let offset = 0;
    while (offset < block.length) {
      const remaining = block.slice(offset);
      if (!remaining.trim()) break;
      let length = Math.min(maximum, remaining.length);
      if (length < remaining.length) {
        const boundary = remaining.slice(0, length + 1).search(/(?<=[.!?])\s+(?=[A-Z#*-])|\n|\s(?=\S+$)/);
        if (boundary > maximum / 2) length = boundary + 1;
        else {
          const whitespace = remaining.slice(0, length).lastIndexOf(' ');
          if (whitespace > maximum / 2) length = whitespace + 1;
        }
      }
      const piece = remaining.slice(0, length);
      const leading = piece.length - piece.trimStart().length;
      const trailing = piece.length - piece.trimEnd().length;
      const text = piece.trim();
      if (text) chunks.push({ text, start: blockStart + offset + leading, end: blockStart + offset + piece.length - trailing });
      offset += Math.max(length, 1);
    }
  }
  return chunks;
}

function audioExtension(mimeType: string): string | null {
  const mime = mimeType.toLowerCase().split(';', 1)[0]!.trim();
  return ({
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/flac': 'flac',
  } as Record<string, string>)[mime] ?? null;
}

async function hashPassword(password: string, random: (size: number) => Uint8Array) { const salt = Buffer.from(random(16)); const hash = await scrypt(password, salt, 32) as Buffer; return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`; }

export async function runArchiveTool<Name extends ArchiveToolName>(name: Name, rawInput: unknown, context: DomainToolContext, dependencies: ArchiveToolDependencies = {}): Promise<ArchiveToolOutput<Name>> {
  if (!isArchiveToolName(name)) throw new ArchiveError('ARCHIVE_INVALID_INPUT', 'Unknown Archive tool.', String(name), { action: 'parse' });
  const tool = name; const member = principal(context, tool); let input: any;
  try { input = archiveToolInputSchemas[tool].parse(rawInput); } catch (error) { throw mappedError(error, tool, 'parse'); }
  const d = await defaults(dependencies, context);
  const canPermanentlyDelete = dependencies.canPermanentlyDelete ?? ((candidate: { deletedAt?: string | null }) => {
    if (process.env.ARCHIVE_PERMANENT_DELETE_ENABLED !== 'true' || !candidate.deletedAt) return false;
    const configuredDays = Number(process.env.ARCHIVE_RETENTION_DAYS ?? 30);
    const retentionDays = Number.isFinite(configuredDays) && configuredDays >= 0 ? configuredDays : 30;
    return d.clock().getTime() - new Date(candidate.deletedAt).getTime() >= retentionDays * 86_400_000;
  });
  const invocationKey = d.id();
  const invocationStarted = performance.now();
  const now = () => d.clock().toISOString();
  const event = (type: SafeEvent['type'], status: SafeEvent['status'], action?: string, resourceKey?: string, scopeKey?: string, durationMs?: number) => observe(dependencies, { type, status, tool, invocationKey, action, resourceKey, scopeKey, durationMs });
  await event('action', 'started', 'tool', undefined, context.runtimeScopeKey);
  const observeRepository = (target: ArchiveRepository): ArchiveRepository => new Proxy(target, {
    get(repository, property, receiver) {
      const value = Reflect.get(repository, property, receiver);
      if (property === 'transaction' && typeof value === 'function') {
        return (operation: (bound: ArchiveRepository) => Promise<unknown>) => value.call(repository, (bound: ArchiveRepository) => operation(observeRepository(bound)));
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
  const action = async (slug: Action, actionInput: Record<string, unknown>, resourceKey?: string, scopeKey?: string) => {
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
  const embed = async (text: string, resourceKey?: string, scopeKey?: string) => {
    const started = performance.now();
    await event('embedding', 'started', 'embed', resourceKey, scopeKey);
    try {
      const embedding = z.array(z.number().finite()).min(1).parse(await d.embed(text));
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
      catch (error) { throw new ArchiveError('ARCHIVE_CONFLICT', 'Storage deletion failed; metadata pointers were retained for retry.', tool, { action: 'storage', resourceKey, cause: error, retryable: true }); }
    }
  };
  const roleFor = async (scopeKey: string, minimum: Role, resourceKey?: string) => {
    const started = performance.now();
    await event('authorization', 'started', minimum, resourceKey, scopeKey);
    try {
      const scope = await repo.getScope(scopeKey);
      if (!scope || scope.organizationKey !== context.organizationKey) fail('ARCHIVE_NOT_FOUND', 'Scope was not found in this organization.', tool, 'resolution', resourceKey);
      if (scope.deletedAt) fail('ARCHIVE_FORBIDDEN', 'Archived scopes cannot be mutated or searched.', tool, 'authorization', resourceKey);
      const role: Role | null = member.userOrganization.orgRole === 'owner' || member.userOrganization.orgRole === 'admin' ? member.userOrganization.orgRole : await repo.role(scopeKey, member.userOrganization.key);
      if (!role || rank[role] < rank[minimum]) fail('ARCHIVE_FORBIDDEN', 'The principal lacks the required scope role.', tool, 'authorization', resourceKey);
      await event('authorization', 'succeeded', minimum, resourceKey, scopeKey, Math.round(performance.now() - started));
      return role;
    } catch (error) {
      await event('authorization', 'failed', minimum, resourceKey, scopeKey, Math.round(performance.now() - started));
      throw error;
    }
  };
  const folder = async (key: string, minimum: Role = 'viewer', archived = true, pendingDeletion = false) => {
    const value = await repo.getFolder(key);
    if (!value) fail('ARCHIVE_NOT_FOUND', 'Folder was not found.', tool, 'read', key);
    await roleFor(value.scopeKey, minimum, key);
    if (!pendingDeletion && value._internalDeletion) fail('ARCHIVE_NOT_FOUND', 'Folder was not found.', tool, 'read', key);
    if (!archived && value.deletedAt) fail('FOLDER_ARCHIVED', 'Folder is archived.', tool, 'read', key);
    return value;
  };
  const folderAncestors = async (parentKey: string | undefined, scopeKey: string, minimum: Role): Promise<Folder[]> => {
    const ancestors: Folder[] = [];
    const visited = new Set<string>();
    let currentKey = parentKey;
    while (currentKey) {
      if (visited.has(currentKey)) fail('FOLDER_CYCLE_DETECTED', 'The folder hierarchy contains a cycle.', tool, 'resolution', currentKey);
      visited.add(currentKey);
      const current = await repo.getFolder(currentKey);
      if (!current || current.scopeKey !== scopeKey) fail('ARCHIVE_CONFLICT', 'Folder ancestor left the requested scope.', tool, 'resolution', currentKey);
      if (current._internalDeletion) fail('ARCHIVE_NOT_FOUND', 'Folder was not found.', tool, 'read', currentKey);
      await roleFor(current.scopeKey, minimum, current.key);
      ancestors.push(current);
      currentKey = current.parentFolderKey;
    }
    return ancestors;
  };
  const document = async (key: string, minimum: Role = 'viewer', archived = true, pendingDeletion = false) => {
    const value = await repo.getDocument(key);
    if (!value) fail('ARCHIVE_NOT_FOUND', 'Document was not found.', tool, 'read', key);
    await roleFor(value.scopeKey, minimum, key);
    if (!pendingDeletion && value._internalDeletion) fail('ARCHIVE_NOT_FOUND', 'Document was not found.', tool, 'read', key);
    if (!archived && value.deletedAt) fail('DOCUMENT_ARCHIVED', 'Document is archived.', tool, 'read', key);
    let parentKey: string | undefined = value.folderKey;
    const visited = new Set<string>();
    while (parentKey) {
      if (visited.has(parentKey)) fail('FOLDER_CYCLE_DETECTED', 'The document folder hierarchy contains a cycle.', tool, 'resolution', parentKey);
      visited.add(parentKey);
      const parent = await repo.getFolder(parentKey);
      if (!parent || parent.scopeKey !== value.scopeKey) fail('ARCHIVE_CONFLICT', 'Document folder resolution failed.', tool, 'resolution', key);
      if (!pendingDeletion && parent._internalDeletion) fail('ARCHIVE_NOT_FOUND', 'Document was not found.', tool, 'read', key);
      if (!archived && parent.deletedAt) fail('FOLDER_ARCHIVED', 'The containing folder hierarchy is archived.', tool, 'read', parent.key);
      parentKey = parent.parentFolderKey;
    }
    return value;
  };
  const foldersIn = async (scopeKey: string, includePendingDeletion = false) => (await repo.listFolders(scopeKey, true, includePendingDeletion))
    .filter((item) => includePendingDeletion || !item._internalDeletion);
  const descendants = (all: Folder[], key: string) => { const out: Folder[] = []; const pending = [key]; const seen = new Set(pending); while (pending.length) { const parentKey = pending.shift()!; for (const child of all.filter((f) => f.parentFolderKey === parentKey)) if (!seen.has(child.key)) { seen.add(child.key); out.push(child); pending.push(child.key); } } return out; };
  const activeFolderHierarchy = async (key: string, scopeKey: string) => {
    let currentKey: string | undefined = key;
    const visited = new Set<string>();
    while (currentKey) {
      if (visited.has(currentKey)) return false;
      visited.add(currentKey);
      const current = await repo.getFolder(currentKey);
      if (!current || current.scopeKey !== scopeKey || current.deletedAt || current._internalDeletion) return false;
      currentKey = current.parentFolderKey;
    }
    return true;
  };
  const generated = async (doc: Document, instruction: string, deep = false) => {
    const slug = deep ? 'deep-reason' : 'reason';
    const output = await action(slug, { instruction, content: doc.content, title: doc.name }, doc.key, doc.scopeKey);
    if (!output.text?.trim()) fail('ARCHIVE_CONFLICT', 'The generation action returned invalid output.', tool, slug, doc.key);
    return output.text.trim();
  };
  const representations = async (
    source: { html?: string; json?: Document['json']; content?: string },
    documentName: string,
    resourceKey: string,
    scopeKey: string,
  ) => {
    let initialHtml = source.html;
    if (!initialHtml) {
      const generatedHtml = await action('document-generate-html', source.json ? { json: source.json } : { content: source.content }, resourceKey, scopeKey);
      initialHtml = z.string().min(1).parse(generatedHtml.html);
    }
    initialHtml = z.string().min(1).parse(initialHtml);
    const generatedJson = await action('document-generate-json', { html: initialHtml }, resourceKey, scopeKey);
    const json = editorDocumentJsonSchema.parse(generatedJson.json);
    const regeneratedHtml = await action('document-generate-html', { json }, resourceKey, scopeKey);
    const html = z.string().min(1).parse(regeneratedHtml.html);
    const generatedContent = await action('document-generate-content', { json }, resourceKey, scopeKey);
    const content = z.string().trim().min(1).parse(generatedContent.content);
    const embedded = await action('document-embed', { name: documentName, content }, resourceKey, scopeKey);
    const embedding = z.array(z.number().finite()).min(1).parse(embedded.embedding);
    return { html, json, content, embedding };
  };
  const persistGenerated = async (source: Document, text: string, mode: 'copy' | 'replace', suffix: string) => {
    const finalName = mode === 'copy' ? `${source.name} (${suffix})` : source.name;
    const transformed = await representations({ content: text }, finalName, source.key, source.scopeKey);
    if (mode === 'replace') {
      const backup = await repo.createVersion({
        scopeKey: source.scopeKey,
        documentKey: source.key,
        html: source.html,
        json: source.json,
        content: source.content,
        embedding: source.embedding,
      });
      try {
        await repo.updateDocument(source.key, { ...transformed, updatedAt: now() });
      } catch (error) {
        try { await repo.deleteVersion(backup.key); }
        catch (cleanupError) { throw new ArchiveError('ARCHIVE_CONFLICT', 'AI replacement failed and backup compensation requires retry.', tool, { action: 'cleanup', resourceKey: source.key, cause: new AggregateError([error, cleanupError]), retryable: true }); }
        throw error;
      }
      return source.key;
    }
    const key = d.id();
    const bytes = new TextEncoder().encode(transformed.content);
    const storageKey = `archive/${context.organizationKey}/${source.scopeKey}/${key}/derived.txt`;
    await storageOperation('upload', key, source.scopeKey, () => d.storage.upload({ key: storageKey, bytes, mimeType: 'text/plain' }));
    try {
      const timestamp = now();
      await repo.insertDocument({
        ...source,
        ...transformed,
        key,
        name: finalName,
        extension: 'txt',
        mimeType: 'text/plain',
        storageKey,
        sizeBytes: bytes.byteLength,
        deletedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return key;
    } catch (error) {
      try { await storageOperation('delete', key, source.scopeKey, () => d.storage.delete(storageKey)); }
      catch (cleanupError) { throw new ArchiveError('ARCHIVE_CONFLICT', 'Generated document insertion failed and storage cleanup requires retry.', tool, { action: 'cleanup', resourceKey: key, cause: new AggregateError([error, cleanupError]), retryable: true }); }
      throw error;
    }
  };
  const mutation = isArchiveMutation(tool, input);
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
    if (claim.status === 'replay') return archiveToolOutputSchemas[tool].parse(claim.response) as ArchiveToolOutput<Name>;
    if (claim.status === 'conflict') fail('ARCHIVE_CONFLICT', 'Idempotency key was already used with a different request.', tool, 'idempotency');
    if (claim.status === 'pending') throw new ArchiveError('ARCHIVE_CONFLICT', 'An invocation with this idempotency key is still pending.', tool, { action: 'idempotency', retryable: true });
    ownsIdempotencyClaim = true;
  }
  let resourceKeys: string[] = []; let result: unknown;
  try {
    if (tool === 'folder.create') {
      const creates = input.folders.map((item: any) => ({ ...item, key: item.key ?? d.id() }));
      resourceKeys = creates.map((item: any) => item.key);
      result = await batch(tool, creates.map((item: any) => ({
        key: item.key,
        run: async () => {
          await roleFor(item.scopeKey, 'moderator');
          if (item.parentFolderKey) {
            const parent = await folder(item.parentFolderKey, 'moderator', false);
            if (parent.scopeKey !== item.scopeKey) fail('FOLDER_MOVE_FORBIDDEN', 'Parent belongs to another scope.', tool, 'insert', item.parentFolderKey);
          }
          const embedding = await embed([item.name, item.description].filter(Boolean).join('\n\n'), item.key, item.scopeKey);
          const timestamp = now();
          const value = await repo.insertFolder({
            key: item.key,
            scopeKey: item.scopeKey,
            ...(item.parentFolderKey ? { parentFolderKey: item.parentFolderKey } : {}),
            name: item.name,
            ...(item.description ? { description: item.description } : {}),
            embedding,
            deletedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          return { folder: folderView(value) };
        },
      })), false, repo);
    } else if (tool === 'folder.find') {
      resourceKeys = input.folderKeys;
      result = await batch(tool, input.folderKeys.map((key: string) => ({
        key,
        run: async () => {
          const current = await folder(key);
          if (current.deletedAt && !input.includeArchived) fail('ARCHIVE_NOT_FOUND', 'Folder was not found.', tool, 'read', key);
          const allFolders = await foldersIn(current.scopeKey);
          const allDocuments = await repo.listDocuments(current.scopeKey, true);
          return {
            folder: {
              ...folderView(current),
              ...(input.includeChildrenCount ? { childrenCount: allFolders.filter((item) => item.parentFolderKey === key).length } : {}),
              ...(input.includeDocumentCount ? { documentCount: allDocuments.filter((item) => item.folderKey === key).length } : {}),
            },
          };
        },
      })), false, repo);
    } else if (tool === 'folder.list') {
      await roleFor(input.scopeKey, 'viewer');
      if (input.parentFolderKey) {
        await folder(input.parentFolderKey, 'viewer', input.includeArchived ?? false);
        if (!input.includeArchived && !await activeFolderHierarchy(input.parentFolderKey, input.scopeKey)) fail('FOLDER_ARCHIVED', 'Folder hierarchy is archived.', tool, 'read', input.parentFolderKey);
      }
      const values = (await foldersIn(input.scopeKey))
        .filter((item) => item.parentFolderKey === input.parentFolderKey && (input.includeArchived || !item.deletedAt));
      const sort = input.sort ?? { field: 'name', direction: 'asc' };
      values.sort((left: any, right: any) => String(left[sort.field]).localeCompare(String(right[sort.field])) * (sort.direction === 'asc' ? 1 : -1));
      const offset = input.cursor ? Number(Buffer.from(input.cursor, 'base64url').toString()) || 0 : 0;
      const limit = input.limit ?? 50;
      const documents = input.includeDocuments && input.parentFolderKey
        ? (await repo.listDocuments(input.scopeKey)).filter((item) => item.folderKey === input.parentFolderKey).map(documentView)
        : undefined;
      result = {
        folders: values.slice(offset, offset + limit).map(folderView),
        ...(documents ? { documents } : {}),
        ...(offset + limit < values.length ? { cursor: Buffer.from(String(offset + limit)).toString('base64url') } : {}),
      };
    } else if (['folder.update', 'folder.rename'].includes(tool)) {
      const items = tool === 'folder.update' ? input.updates : input.renames;
      if (input.atomic) fail('ARCHIVE_CONFLICT', 'Atomic folder metadata updates are unavailable because embedding is an external side effect.', tool, 'embed');
      resourceKeys = items.map((item: any) => item.folderKey);
      result = await batch(tool, items.map((item: any) => ({
        key: item.folderKey,
        preflight: async () => { await folder(item.folderKey, 'moderator', false); },
        run: async (mutationRepository: ArchiveRepository) => {
          const current = await folder(item.folderKey, 'moderator', false);
          const name = item.name ?? current.name;
          const description = item.description === null ? undefined : item.description ?? current.description;
          const embedding = await embed([name, description].filter(Boolean).join('\n\n'), current.key, current.scopeKey);
          const patch = {
            ...(item.name !== undefined ? { name: item.name } : {}),
            ...(item.description !== undefined ? { description: item.description ?? undefined } : {}),
            embedding,
            updatedAt: now(),
          };
          return { folder: folderView(await mutationRepository.updateFolder(current.key, patch)) };
        },
      })), input.atomic, repo);
    } else if (tool === 'folder.move') {
      resourceKeys = input.moves.map((item: any) => item.folderKey);
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
        run: async (mutationRepository: ArchiveRepository) => {
          const source = await folder(item.folderKey, 'admin', false);
          const moved = await mutationRepository.updateFolder(source.key, {
            parentFolderKey: item.targetParentFolderKey,
            updatedAt: now(),
          });
          return { folder: folderView(moved) };
        },
      })), input.atomic, repo);
    } else if (tool === 'folder.archive' || tool === 'folder.restore') {
      const restore = tool === 'folder.restore';
      resourceKeys = input.folderKeys;
      const lifecycleItems = input.folderKeys.map((key: string) => ({
        key,
        preflight: async () => {
          const root = await folder(key, 'moderator');
          if (restore) {
            const ancestors = await folderAncestors(root.parentFolderKey, root.scopeKey, 'moderator');
            if (!input.restoreAncestors && ancestors.some((ancestor) => ancestor.deletedAt)) fail('FOLDER_ARCHIVED', 'Restore the archived ancestor hierarchy first.', tool, 'update', key);
          }
        },
        run: async (mutationRepository: ArchiveRepository) => {
          const root = await folder(key, 'moderator');
          const allFolders = await foldersIn(root.scopeKey);
          const children = descendants(allFolders, key);
          if (!restore && !input.includeDescendants && children.some((child) => !child.deletedAt)) {
            fail('FOLDER_NOT_EMPTY', 'Folder has active descendants.', tool, 'update', key);
          }
          const ancestors = restore ? await folderAncestors(root.parentFolderKey, root.scopeKey, 'moderator') : [];
          if (restore && !input.restoreAncestors && ancestors.some((ancestor) => ancestor.deletedAt)) fail('FOLDER_ARCHIVED', 'Restore the archived ancestor hierarchy first.', tool, 'update', key);
          const affectedFolders = [root, ...(input.includeDescendants ? children : [])];
          const affectedFolderKeys = new Set(affectedFolders.map((item) => item.key));
          const affectedDocuments = (await repo.listDocuments(root.scopeKey, true))
            .filter((item) => affectedFolderKeys.has(item.folderKey));
          const timestamp = now();
          for (const item of affectedFolders) {
            await mutationRepository.updateFolder(item.key, { deletedAt: restore ? null : timestamp, updatedAt: timestamp });
          }
          for (const item of affectedDocuments) {
            await mutationRepository.updateDocument(item.key, { deletedAt: restore ? null : timestamp, updatedAt: timestamp });
          }
          if (restore && input.restoreAncestors) for (const ancestor of ancestors) {
            await mutationRepository.updateFolder(ancestor.key, { deletedAt: null, updatedAt: timestamp });
          }
          return { folder: folderView({ ...root, deletedAt: restore ? null : timestamp, updatedAt: timestamp }) };
        },
      }));
      result = await batch(tool, lifecycleItems, input.atomic, repo);
    } else if (tool === 'folder.delete') {
      resourceKeys = input.folderKeys;
      result = await batch(tool, input.folderKeys.map((key: string) => ({
        key,
        preflight: async () => {
          const root = await folder(key, 'owner', true, true);
          if (!root.deletedAt) fail('ARCHIVE_CONFLICT', 'Folder must be archived before permanent deletion.', tool, 'delete', key);
          if (!await canPermanentlyDelete({ kind: 'folder', deletedAt: root.deletedAt, context })) fail('ARCHIVE_FORBIDDEN', 'Folder retention policy denied permanent deletion.', tool, 'delete', key);
        },
        run: async (mutationRepository: ArchiveRepository) => {
          if (input.atomic) {
            const candidate = await mutationRepository.getFolder(key);
            if (!candidate) fail('ARCHIVE_NOT_FOUND', 'Folder was not found.', tool, 'read', key);
            const all = await mutationRepository.listFolders(candidate.scopeKey, true, true);
            const children = descendants(all, key);
            const affected = input.recursive ? [candidate, ...children] : [candidate];
            const affectedKeys = new Set(affected.map((item) => item.key));
            const documents = (await mutationRepository.listDocuments(candidate.scopeKey, true, true)).filter((item) => affectedKeys.has(item.folderKey));
            if (!input.recursive && children.length > 0) fail('FOLDER_NOT_EMPTY', 'Folder is not empty.', tool, 'delete', key);
            if (documents.length > 0) fail('ARCHIVE_CONFLICT', 'Atomic folder deletion is unavailable when storage objects are involved.', tool, 'storage', key);
            for (const item of affected) {
              if (!item.deletedAt) fail('ARCHIVE_CONFLICT', 'Every recursively deleted folder must be archived.', tool, 'delete', item.key);
              if (!await canPermanentlyDelete({ kind: 'folder', deletedAt: item.deletedAt, context })) fail('ARCHIVE_FORBIDDEN', 'Folder retention policy denied permanent deletion.', tool, 'delete', item.key);
            }
            const marker = { kind: 'folder' as const, owner: invocationKey, startedAt: now(), objectKeys: [] };
            for (const item of [...affected].reverse()) await mutationRepository.setFolderDeletion(item.key, marker);
            for (const item of [...affected].reverse()) await mutationRepository.deleteFolder(item.key);
            return {};
          }
          if (!repo.transaction) fail('ARCHIVE_CONFLICT', 'Transaction-bound deletion marking is unavailable.', tool, 'transaction', key);
          let ownsFreeze = false;
          let storageStarted = false;
          let root: Folder;
          let affected: Folder[] = [];
          let documents: Document[] = [];
          try {
            ({ root, affected, documents } = await repo.transaction(async (bound) => {
              const candidate = await bound.getFolder(key);
              if (!candidate) fail('ARCHIVE_NOT_FOUND', 'Folder was not found.', tool, 'read', key);
              if (candidate._internalDeletion) {
                if (candidate._internalDeletion.kind !== 'folder') fail('ARCHIVE_CONFLICT', 'A different deletion is already pending.', tool, 'delete', key);
                const all = await bound.listFolders(candidate.scopeKey, true, true);
                const frozen = input.recursive ? [candidate, ...descendants(all, key)] : [candidate];
                const frozenKeys = new Set(frozen.map((item) => item.key));
                return { root: candidate, affected: frozen, documents: (await bound.listDocuments(candidate.scopeKey, true, true)).filter((item) => frozenKeys.has(item.folderKey)) };
              }
              const all = await bound.listFolders(candidate.scopeKey, true, true);
              const children = descendants(all, key);
              const frozen = input.recursive ? [candidate, ...children] : [candidate];
              const frozenKeys = new Set(frozen.map((item) => item.key));
              const ownedDocuments = (await bound.listDocuments(candidate.scopeKey, true, true)).filter((item) => frozenKeys.has(item.folderKey));
              if (!input.recursive && (children.length > 0 || ownedDocuments.length > 0)) fail('FOLDER_NOT_EMPTY', 'Folder is not empty.', tool, 'delete', key);
              if (ownedDocuments.length > 0 && input.atomic) fail('ARCHIVE_CONFLICT', 'Atomic folder deletion is unavailable when storage objects are involved.', tool, 'storage', key);
              for (const item of frozen) {
                if (!item.deletedAt) fail('ARCHIVE_CONFLICT', 'Every recursively deleted folder must be archived.', tool, 'delete', item.key);
                if (!await canPermanentlyDelete({ kind: 'folder', deletedAt: item.deletedAt, context })) fail('ARCHIVE_FORBIDDEN', 'Folder retention policy denied permanent deletion.', tool, 'delete', item.key);
              }
              for (const item of ownedDocuments) {
                if (!item.deletedAt) fail('ARCHIVE_CONFLICT', 'Every recursively deleted document must be archived.', tool, 'delete', item.key);
                if (!await canPermanentlyDelete({ kind: 'document', deletedAt: item.deletedAt, context })) fail('ARCHIVE_FORBIDDEN', 'Document retention policy denied permanent deletion.', tool, 'delete', item.key);
              }
              const marker = { kind: 'folder' as const, owner: invocationKey, startedAt: now() };
              for (const item of ownedDocuments) await bound.setDocumentDeletion(item.key, marker);
              for (const item of [...frozen].reverse()) await bound.setFolderDeletion(item.key, marker);
              ownsFreeze = true;
              return { root: { ...candidate, _internalDeletion: marker }, affected: frozen, documents: ownedDocuments };
            }));
            const related = await Promise.all(documents.map(async (item) => ({
              document: item,
              versions: await repo.listVersions(item.scopeKey, [item.key], true),
              shares: await repo.listShares(item.scopeKey, [item.key], { includeArchived: true, includeExpired: true, includeRevoked: true }),
            })));
            for (const item of related) for (const version of item.versions) {
              if (!await canPermanentlyDelete({ kind: 'version', deletedAt: item.document.deletedAt, context })) fail('ARCHIVE_FORBIDDEN', 'Version retention policy denied permanent deletion.', tool, 'delete', version.key);
            }
            const inventoriedKeys = [...new Set(related.flatMap((item) => [item.document.storageKey, ...(item.document.speechStorageKeys ?? []), ...item.versions.map((version) => version.storageKey)]).filter((item): item is string => Boolean(item)))];
            const manifest = root._internalDeletion?.objectKeys ? root._internalDeletion : { ...root._internalDeletion!, objectKeys: inventoriedKeys };
            if (!root._internalDeletion?.objectKeys) {
              const persisted = await repo.transaction((bound) => bound.setFolderDeletion(root.key, manifest, root._internalDeletion!.owner));
              if (!persisted) fail('ARCHIVE_CONFLICT', 'Folder deletion manifest ownership changed.', tool, 'transaction', key);
              root = persisted;
            }
            storageStarted = true;
            await deleteStorageKeys(manifest.objectKeys ?? [], root.key, root.scopeKey);
          const removeMetadata = async (bound: ArchiveRepository) => {
            for (const item of related) {
              for (const version of item.versions) await bound.deleteVersion(version.key);
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
    } else if (tool === 'document.processing') {
      resourceKeys = [input.folderKey];
      await roleFor(input.scopeKey, 'moderator');
      const parent = await folder(input.folderKey, 'moderator', false);
      if (parent.scopeKey !== input.scopeKey) fail('ARCHIVE_FORBIDDEN', 'Folder does not belong to the requested scope.', tool, 'authorization', parent.key);
      const processingLogger = dependencies.ingestion?.logger;
      const processingInput = input.idempotencyKey ? {
        ...input,
        idempotencyKey: createHash('sha256').update(member.user.key).update('\0').update(input.idempotencyKey).digest('hex'),
      } : input;
      const processed = await d.processDocument(processingInput, {
        ...dependencies.ingestion,
        storage: d.storage,
        logger(processingEvent) {
          processingLogger?.(processingEvent);
          const status = processingEvent.status === 'started' ? 'started' : processingEvent.status === 'completed' ? 'succeeded' : 'failed';
          void event('action', status, typeof processingEvent.action === 'string' ? processingEvent.action : 'document.processing', typeof processingEvent.documentKey === 'string' ? processingEvent.documentKey : undefined, input.scopeKey, typeof processingEvent.durationMs === 'number' ? processingEvent.durationMs : undefined);
        },
      });
      result = { document: documentView(processed.document) };
    } else if (tool === 'document.find') {
      resourceKeys = input.documentKeys;
      result = await batch(tool, input.documentKeys.map((key: string) => ({
        key,
        run: async () => {
          const current = await document(key);
          if (current.deletedAt && !input.includeArchived) fail('ARCHIVE_NOT_FOUND', 'Document was not found.', tool, 'read', key);
          const include: string[] = input.include ?? [];
          const latest = include.includes('latestVersion') ? (await repo.listVersions(current.scopeKey, [current.key]))[0] : undefined;
          const parent = include.includes('folder') ? await repo.getFolder(current.folderKey) : undefined;
          return {
            document: {
              ...documentView(current),
              ...(include.includes('html') ? { html: current.html } : {}),
              ...(include.includes('json') ? { json: current.json } : {}),
              ...(include.includes('content') ? { content: current.content } : {}),
              ...(include.includes('embedding') ? { embedding: current.embedding } : {}),
              ...(parent ? { folder: folderView(parent) } : {}),
              ...(include.includes('shares') ? { shares: (await repo.listShares(current.scopeKey, [current.key])).map(shareView) } : {}),
              ...(latest ? { latestVersion: versionView(latest) } : {}),
            },
          };
        },
      })), false, repo);
    } else if (tool === 'document.list') {
      const parent = await folder(input.folderKey, 'viewer', input.includeArchived ?? false);
      if (!input.includeArchived && !await activeFolderHierarchy(parent.key, parent.scopeKey)) fail('FOLDER_ARCHIVED', 'Folder hierarchy is archived.', tool, 'read', parent.key);
      const values = (await repo.listDocuments(parent.scopeKey, input.includeArchived))
        .filter((item) => !item._internalDeletion && item.folderKey === parent.key && (!input.extensions || input.extensions.includes(item.extension)));
      const sort = input.sort ?? { field: 'name', direction: 'asc' };
      values.sort((left: any, right: any) => String(left[sort.field]).localeCompare(String(right[sort.field])) * (sort.direction === 'asc' ? 1 : -1));
      const offset = input.cursor ? Number(Buffer.from(input.cursor, 'base64url').toString()) || 0 : 0;
      const limit = input.limit ?? 50;
      result = {
        documents: values.slice(offset, offset + limit).map(documentView),
        ...(offset + limit < values.length ? { cursor: Buffer.from(String(offset + limit)).toString('base64url') } : {}),
      };
    } else if (tool === 'document.read') {
      resourceKeys = input.documentKeys;
      if (input.atomic && input.mode === 'audio') fail('ARCHIVE_CONFLICT', 'Atomic audio generation is impossible because speech is an external side effect.', tool, 'speak');
      result = await batch(tool, input.documentKeys.map((key: string) => ({
        key,
        run: async () => {
          const current = await document(key, 'viewer', false);
          if (input.mode === 'content') return { documentKey: key, title: current.name, content: current.content };
          if (input.mode === 'html') return { documentKey: key, title: current.name, html: current.html };
          if (input.mode === 'json') return { documentKey: key, title: current.name, json: current.json };
          const start = input.startOffset ?? 0;
          const end = Math.min(input.endOffset ?? current.content.length, current.content.length);
          const maximum = Math.min(Math.max(dependencies.maxSpeechChunkCharacters ?? 1800, 200), 4000);
          const documentChunks = speechChunks(current.content.slice(start, end), input.includeCode ?? false, maximum)
            .map((chunk) => ({ ...chunk, start: start + chunk.start, end: start + chunk.end }));
          if (input.includeTitle && documentChunks[0]) documentChunks[0] = { ...documentChunks[0], text: `${current.name}. ${documentChunks[0].text}` };
          const chunks = documentChunks;
          const audio: Array<{ index: number; storageKey?: string; url?: string; durationMs?: number; startCharacter: number; endCharacter: number }> = [];
          const uploaded: string[] = [];
          let duration = 0;
          try {
            for (let index = 0; index < chunks.length; index += 1) {
              const chunk = chunks[index]!;
              const spoken = await action('speak', { text: chunk.text, language: input.language, voice: input.voice, speakingRate: input.speakingRate }, key, current.scopeKey);
              const bytes = z.instanceof(Uint8Array).parse(spoken.audio);
              const mimeType = z.string().min(1).parse(spoken.mimeType ?? 'audio/mpeg');
              const item = {
                index,
                startCharacter: chunk.start,
                endCharacter: chunk.end,
                ...(spoken.durationMs !== undefined ? { durationMs: spoken.durationMs } : {}),
              };
              if (input.persistAudio) {
                const extension = audioExtension(mimeType);
                if (!extension) fail('DOCUMENT_SPEECH_FAILED', 'Speech MIME type cannot be persisted safely.', tool, 'speak', key);
                const storageKey = `archive/${context.organizationKey}/${current.scopeKey}/${key}/speech/${invocationKey}/${String(index).padStart(4, '0')}.${extension}`;
                await storageOperation('upload', key, current.scopeKey, () => d.storage.upload({ key: storageKey, bytes, mimeType }));
                uploaded.push(storageKey);
                audio.push({ ...item, storageKey });
              } else {
                audio.push({ ...item, url: `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}` });
              }
              duration += spoken.durationMs ?? 0;
            }
            if (input.persistAudio && uploaded.length > 0) {
              await repo.updateDocument(current.key, {
                speechStorageKeys: [...new Set([...(current.speechStorageKeys ?? []), ...uploaded])],
                updatedAt: now(),
              });
            }
          } catch (error) {
            const cleanupErrors: unknown[] = [];
            for (const storageKey of uploaded.reverse()) {
              try { await storageOperation('delete', key, current.scopeKey, () => d.storage.delete(storageKey)); }
              catch (cleanupError) { cleanupErrors.push(cleanupError); await event('cleanup', 'failed', 'storage-delete', key, current.scopeKey); }
            }
            if (cleanupErrors.length) throw new ArchiveError('ARCHIVE_CONFLICT', 'Speech generation failed and uploaded audio cleanup requires retry.', tool, { action: 'cleanup', resourceKey: key, cause: new AggregateError([error, ...cleanupErrors]), retryable: true });
            throw error;
          }
          return { documentKey: key, title: current.name, audio, ...(duration ? { totalDurationMs: duration } : {}) };
        },
      })), input.atomic, repo);
    } else if (tool === 'document.update') {
      if (input.atomic) fail('ARCHIVE_CONFLICT', 'Atomic document updates are unavailable because transformation and embedding actions are external side effects.', tool, 'document-embed');
      resourceKeys = input.updates.map((item: any) => item.documentKey);
      const updates = input.updates.map((item: any) => ({
        key: item.documentKey,
        preflight: async () => { await document(item.documentKey, 'moderator', false); },
        run: async (mutationRepository: ArchiveRepository) => {
          const current = await document(item.documentKey, 'moderator', false);
          const transformed = await representations(item, current.name, current.key, current.scopeKey);
          let backup: DocumentVersion | undefined;
          if (item.createVersion) {
            backup = await mutationRepository.createVersion({
              scopeKey: current.scopeKey,
              documentKey: current.key,
              html: current.html,
              json: current.json,
              content: current.content,
              embedding: current.embedding,
            });
          }
          try {
            const updated = await mutationRepository.updateDocument(current.key, { ...transformed, updatedAt: now() });
            return { document: documentView(updated) };
          } catch (error) {
            if (backup) {
              try { await mutationRepository.deleteVersion(backup.key); }
              catch (cleanupError) { throw new ArchiveError('ARCHIVE_CONFLICT', 'Document update failed and version compensation requires retry.', tool, { action: 'cleanup', resourceKey: current.key, cause: new AggregateError([error, cleanupError]), retryable: true }); }
            }
            throw error;
          }
        },
      }));
      result = await batch(tool, updates, input.atomic, repo);
    } else if (tool === 'document.rename') {
      if (input.atomic) fail('ARCHIVE_CONFLICT', 'Atomic document rename is unavailable because embedding is an external side effect.', tool, 'document-embed');
      resourceKeys = input.renames.map((item: any) => item.documentKey);
      result = await batch(tool, input.renames.map((item: any) => ({
        key: item.documentKey,
        preflight: async () => { await document(item.documentKey, 'moderator', false); },
        run: async (mutationRepository: ArchiveRepository) => {
          const current = await document(item.documentKey, 'moderator', false);
          const embedded = await action('document-embed', { name: item.name, content: current.content }, current.key, current.scopeKey);
          const embedding = z.array(z.number().finite()).min(1).parse(embedded.embedding);
          const renamed = await mutationRepository.updateDocument(current.key, { name: item.name, embedding, updatedAt: now() });
          return { document: documentView(renamed) };
        },
      })), input.atomic, repo);
    } else if (tool === 'document.move') {
      resourceKeys = input.moves.map((item: any) => item.documentKey);
      result = await batch(tool, input.moves.map((item: any) => ({
        key: item.documentKey,
        preflight: async () => {
          const source = await document(item.documentKey, 'admin', false);
          const target = await folder(item.targetFolderKey, 'admin', false);
          if (source.scopeKey !== target.scopeKey) fail('FOLDER_MOVE_FORBIDDEN', 'Cross-scope document moves are not supported.', tool, 'update', source.key);
        },
        run: async (mutationRepository: ArchiveRepository) => {
          const current = await document(item.documentKey, 'admin', false);
          const moved = await mutationRepository.updateDocument(current.key, { folderKey: item.targetFolderKey, updatedAt: now() });
          return { document: documentView(moved) };
        },
      })), input.atomic, repo);
    } else if (tool === 'document.copy') {
      if (input.atomic) fail('ARCHIVE_CONFLICT', 'Atomic copy is unavailable because storage copy cannot be rolled back transactionally.', tool, 'storage');
      resourceKeys = input.copies.map((item: any) => item.documentKey);
      result = await batch(tool, input.copies.map((item: any) => ({
        key: item.documentKey,
        run: async () => {
          const source = await document(item.documentKey, 'viewer', false);
          const target = await folder(item.targetFolderKey, 'moderator', false);
          const key = d.id();
          const name = item.newName ?? source.name;
          const storageKey = `archive/${context.organizationKey}/${target.scopeKey}/${key}/original.${source.extension}`;
          const insertedVersionKeys: string[] = [];
          const insertedShareKeys: string[] = [];
          let insertedDocument = false;
          await storageOperation('copy', key, target.scopeKey, () => d.storage.copy({ sourceKey: source.storageKey, destinationKey: storageKey, mimeType: source.mimeType }));
          try {
            let embedding = source.embedding;
            if (name !== source.name) {
              const embedded = await action('document-embed', { name, content: source.content }, source.key, target.scopeKey);
              embedding = z.array(z.number().finite()).min(1).parse(embedded.embedding);
            }
            const timestamp = now();
            const copy = await repo.insertDocument({
              ...source,
              key,
              scopeKey: target.scopeKey,
              folderKey: target.key,
              name,
              embedding,
              storageKey,
              deletedAt: null,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            insertedDocument = true;
            if (item.includeVersions) {
              const versions = (await repo.listVersions(source.scopeKey, [source.key])).sort((left, right) => left.version - right.version);
              for (const version of versions) {
                const created = await repo.createVersion({
                  scopeKey: target.scopeKey,
                  documentKey: key,
                  label: version.label,
                  html: version.html,
                  json: version.json,
                  content: version.content,
                  embedding: version.embedding,
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
                  scopeKey: target.scopeKey,
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
              await storageOperation('delete', key, target.scopeKey, () => d.storage.delete(storageKey));
            } catch (cleanupError) {
              throw new ArchiveError('ARCHIVE_CONFLICT', 'Document copy failed and compensation requires retry.', tool, { action: 'cleanup', resourceKey: key, cause: new AggregateError([error, cleanupError]), retryable: true });
            }
            throw error;
          }
        },
      })), false, repo);
    } else if (tool === 'document.archive' || tool === 'document.restore') {
      const restore = tool === 'document.restore';
      resourceKeys = input.documentKeys;
      result = await batch(tool, input.documentKeys.map((key: string) => ({
        key,
        preflight: async () => {
          const current = await document(key, 'moderator');
          if (restore) {
            const ancestors = await folderAncestors(current.folderKey, current.scopeKey, 'moderator');
            if (!input.restoreAncestors && ancestors.some((ancestor) => ancestor.deletedAt)) fail('FOLDER_ARCHIVED', 'Restore the archived containing hierarchy first.', tool, 'update', key);
          }
        },
        run: async (mutationRepository: ArchiveRepository) => {
          const currentDocument = await document(key, 'moderator');
          const ancestors = restore ? await folderAncestors(currentDocument.folderKey, currentDocument.scopeKey, 'moderator') : [];
          if (restore && !input.restoreAncestors && ancestors.some((ancestor) => ancestor.deletedAt)) fail('FOLDER_ARCHIVED', 'Restore the archived containing hierarchy first.', tool, 'update', key);
          if (restore && input.restoreAncestors) for (const ancestor of ancestors) {
            await mutationRepository.updateFolder(ancestor.key, { deletedAt: null, updatedAt: now() });
          }
          const updated = await mutationRepository.updateDocument(key, { deletedAt: restore ? null : now(), updatedAt: now() });
          return { document: documentView(updated) };
        },
      })), input.atomic, repo);
    } else if (tool === 'document.delete') {
      if (input.atomic) fail('ARCHIVE_CONFLICT', 'Atomic deletion is unavailable because storage deletion cannot be rolled back.', tool, 'storage');
      resourceKeys = input.documentKeys;
      result = await batch(tool, input.documentKeys.map((key: string) => ({
        key,
        preflight: async () => {
          const current = await document(key, 'owner', true, true);
          if (!current.deletedAt) fail('ARCHIVE_CONFLICT', 'Document must be archived before permanent deletion.', tool, 'delete', key);
          if (!await canPermanentlyDelete({ kind: 'document', deletedAt: current.deletedAt, context })) fail('ARCHIVE_FORBIDDEN', 'Document retention policy denied permanent deletion.', tool, 'delete', key);
        },
        run: async () => {
          if (!repo.transaction) fail('ARCHIVE_CONFLICT', 'Transaction-bound metadata deletion is unavailable.', tool, 'transaction', key);
          let ownsFreeze = false;
          let storageStarted = false;
          let current = await repo.transaction(async (bound) => {
            const candidate = await bound.getDocument(key);
            if (!candidate) fail('ARCHIVE_NOT_FOUND', 'Document was not found.', tool, 'read', key);
            if (candidate._internalDeletion) {
              if (candidate._internalDeletion.kind !== 'document') fail('ARCHIVE_CONFLICT', 'A different deletion is already pending.', tool, 'delete', key);
              return candidate;
            }
            const marker = { kind: 'document' as const, owner: invocationKey, startedAt: now() };
            const frozen = await bound.setDocumentDeletion(key, marker);
            if (!frozen) fail('ARCHIVE_CONFLICT', 'Document could not be frozen for deletion.', tool, 'transaction', key);
            ownsFreeze = true;
            return frozen;
          });
          try {
            const versions = await repo.listVersions(current.scopeKey, [key], true);
            const shares = await repo.listShares(current.scopeKey, [key], { includeArchived: true, includeExpired: true, includeRevoked: true });
            if (versions.length > 0 && !input.deleteVersions) fail('ARCHIVE_CONFLICT', 'Document has retained versions.', tool, 'delete', key);
            if (shares.length > 0 && !input.deleteShares) fail('ARCHIVE_CONFLICT', 'Document has retained shares.', tool, 'delete', key);
            for (const version of versions) {
              if (!await canPermanentlyDelete({ kind: 'version', deletedAt: current.deletedAt, context })) fail('ARCHIVE_FORBIDDEN', 'Version retention policy denied permanent deletion.', tool, 'delete', version.key);
            }
            const inventoriedKeys = [...new Set([current.storageKey, ...(current.speechStorageKeys ?? []), ...versions.map((version) => version.storageKey)].filter((item): item is string => Boolean(item)))];
            const deletion = current._internalDeletion?.objectKeys ? current._internalDeletion : { ...current._internalDeletion!, objectKeys: inventoriedKeys };
            if (!current._internalDeletion?.objectKeys) {
              const persisted = await repo.transaction((bound) => bound.setDocumentDeletion(key, deletion, current._internalDeletion!.owner));
              if (!persisted) fail('ARCHIVE_CONFLICT', 'Document deletion manifest ownership changed.', tool, 'transaction', key);
              current = persisted;
            }
            storageStarted = true;
            await deleteStorageKeys(deletion.objectKeys ?? [], key, current.scopeKey);
            await repo.transaction(async (bound) => {
              for (const version of versions) await bound.deleteVersion(version.key);
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
      resourceKeys = items.map((item: any) => item.documentKey);
      const byteBudget = Math.min(Math.max(dependencies.maxDownloadBytes ?? 25_000_000, 1), 100_000_000);
      let downloadedBytes = 0;
      const fileOperations = items.map((item: any) => ({
        key: item.documentKey,
        run: async () => {
          const current = await document(item.documentKey, 'viewer', false);
          if (item.format === 'original') {
            const object = await storageOperation('download', current.key, current.scopeKey, () => d.storage.download(current.storageKey));
            downloadedBytes += object.bytes.byteLength;
            if (downloadedBytes > byteBudget) fail('DOCUMENT_TOO_LARGE', 'Combined download byte budget exceeded.', tool, 'storage', current.key);
            return {
              documentKey: current.key,
              format: 'original',
              fileName: `${current.name}.${current.extension}`,
              mimeType: object.mimeType ?? current.mimeType,
              encoding: 'base64' as const,
              content: Buffer.from(object.bytes).toString('base64'),
            };
          }
          const exported = await d.generateExport({ format: item.format, json: current.json });
          downloadedBytes += exported.bytes.byteLength;
          if (downloadedBytes > byteBudget) fail('DOCUMENT_TOO_LARGE', 'Combined export byte budget exceeded.', tool, 'export', current.key);
          return {
            documentKey: current.key,
            format: exported.extension,
            fileName: `${current.name}.${exported.extension}`,
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
      if (input.atomic) fail('ARCHIVE_CONFLICT', 'Atomic share creation is unavailable because secure randomness cannot be rolled back.', tool, 'insert');
      resourceKeys = input.shares.map((item: any) => item.documentKey);
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
      resourceKeys = selectors;
      result = await batch(tool, selectors.map((key: string) => ({
        key,
        preflight: async () => {
          if (input.shareKeys) {
            const share = await repo.getShare(key);
            if (!share) fail('ARCHIVE_NOT_FOUND', 'Share was not found.', tool, 'read', key);
            await document(share.documentKey, 'viewer');
            await roleFor(share.scopeKey, 'moderator', key);
          } else {
            const current = await document(key, 'moderator');
            const shares = await repo.listShares(current.scopeKey, [key], { includeExpired: true, includeRevoked: true });
            if (shares.length === 0) fail('ARCHIVE_NOT_FOUND', 'Document has no shares to revoke.', tool, 'read', key);
          }
        },
        run: async (mutationRepository: ArchiveRepository) => {
          const timestamp = now();
          if (input.shareKeys) {
            const share = await repo.getShare(key);
            if (!share) fail('ARCHIVE_NOT_FOUND', 'Share was not found.', tool, 'read', key);
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
      resourceKeys = input.documentKeys;
      result = await batch(tool, input.documentKeys.map((key: string) => ({
        key,
        run: async () => {
          const current = await document(key, 'moderator');
          const shares = await repo.listShares(current.scopeKey, [key], { includeExpired: input.includeExpired, includeRevoked: input.includeRevoked, at: now() });
          return { documentKey: key, shares: shares.map(shareView) };
        },
      })), false, repo);
    } else if (tool === 'document.create-version') {
      resourceKeys = input.documentKeys;
      result = await batch(tool, input.documentKeys.map((key: string) => ({
        key,
        preflight: async () => { await document(key, 'moderator', false); },
        run: async (mutationRepository: ArchiveRepository) => {
          const current = await document(key, 'moderator', false);
          const version = await mutationRepository.createVersion({
            scopeKey: current.scopeKey,
            documentKey: key,
            label: input.labels?.[key],
            html: current.html,
            json: current.json,
            content: current.content,
            embedding: current.embedding,
          });
          return { version: versionView(version) };
        },
      })), input.atomic, repo);
    } else if (tool === 'document.find-version') {
      resourceKeys = input.versionKeys;
      result = await batch(tool, input.versionKeys.map((key: string) => ({
        key,
        run: async () => {
          const version = await repo.getVersion(key);
          if (!version || version.deletedAt) fail('ARCHIVE_NOT_FOUND', 'Version was not found.', tool, 'read', key);
          await document(version.documentKey, 'viewer');
          await roleFor(version.scopeKey, 'viewer', key);
          return { version: versionView(version, input.include) };
        },
      })), false, repo);
    } else if (tool === 'document.list-versions') {
      resourceKeys = input.documentKeys;
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
      resourceKeys = input.restores.map((item: any) => item.documentKey);
      result = await batch(tool, input.restores.map((item: any) => ({
        key: item.documentKey,
        preflight: async () => {
          const current = await document(item.documentKey, 'moderator', false);
          const rawVersion = await repo.getVersion(item.versionKey);
          const version = rawVersion ? documentVersionSchema.safeParse(rawVersion) : null;
          if (!version?.success || version.data.deletedAt || version.data.documentKey !== current.key || version.data.scopeKey !== current.scopeKey) {
            fail('DOCUMENT_VERSION_CONFLICT', 'A complete version belonging to the document is required.', tool, 'read', item.versionKey);
          }
        },
        run: async (mutationRepository: ArchiveRepository) => {
          const current = await document(item.documentKey, 'moderator', false);
          const version = documentVersionSchema.parse(await repo.getVersion(item.versionKey));
          let backup: DocumentVersion | undefined;
          if (item.createBackupVersion) {
            backup = await mutationRepository.createVersion({
              scopeKey: current.scopeKey,
              documentKey: current.key,
              html: current.html,
              json: current.json,
              content: current.content,
              embedding: current.embedding,
            });
          }
          try {
            const restored = await mutationRepository.updateDocument(current.key, {
              html: version.html,
              json: version.json,
              content: version.content,
              embedding: version.embedding,
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
      resourceKeys = input.versionKeys;
      result = await batch(tool, input.versionKeys.map((key: string) => ({
        key,
        preflight: async () => {
          const version = await repo.getVersion(key);
          if (!version) fail('ARCHIVE_NOT_FOUND', 'Version was not found.', tool, 'read', key);
          const current = await document(version.documentKey, 'owner', true, true);
          if (current._internalDeletion && (current._internalDeletion.kind !== 'version' || current._internalDeletion.versionKey !== key)) fail('ARCHIVE_CONFLICT', 'A different deletion is already pending.', tool, 'delete', key);
          if (!current.deletedAt) fail('ARCHIVE_CONFLICT', 'The document must be archived before deleting a version.', tool, 'delete', key);
          if (!await canPermanentlyDelete({ kind: 'version', deletedAt: current.deletedAt, context })) fail('ARCHIVE_FORBIDDEN', 'Version deletion is disabled by retention policy.', tool, 'delete', key);
          if (input.atomic && version.storageKey) fail('ARCHIVE_CONFLICT', 'Atomic version deletion is unavailable when a storage object is involved.', tool, 'storage', key);
        },
        run: async (mutationRepository: ArchiveRepository) => {
          const selected = await repo.getVersion(key);
          if (!selected) fail('ARCHIVE_NOT_FOUND', 'Version was not found.', tool, 'read', key);
          if (input.atomic && !selected.storageKey) {
            await mutationRepository.deleteVersion(key);
            return {};
          }
          if (!repo.transaction) fail('ARCHIVE_CONFLICT', 'Transaction-bound version deletion is unavailable.', tool, 'transaction', key);
          const { version, current } = await repo.transaction(async (bound) => {
            const version = await bound.getVersion(key);
            if (!version) fail('ARCHIVE_NOT_FOUND', 'Version was not found.', tool, 'read', key);
            const current = await bound.getDocument(version.documentKey);
            if (!current) fail('ARCHIVE_NOT_FOUND', 'Version owner was not found.', tool, 'read', version.documentKey);
            if (current._internalDeletion) {
              if (current._internalDeletion.kind !== 'version' || current._internalDeletion.versionKey !== key) fail('ARCHIVE_CONFLICT', 'A different deletion is already pending.', tool, 'delete', key);
              return { version, current };
            }
            const marker = { kind: 'version' as const, owner: invocationKey, objectKeys: version.storageKey ? [version.storageKey] : [], startedAt: now(), versionKey: key };
            const frozen = await bound.setDocumentDeletion(current.key, marker);
            if (!frozen) fail('ARCHIVE_CONFLICT', 'Version owner could not be frozen.', tool, 'transaction', key);
            return { version, current: frozen };
          });
          await deleteStorageKeys(current._internalDeletion!.objectKeys ?? [], key, version.scopeKey);
          await repo.transaction(async (bound) => {
            await bound.deleteVersion(key);
            await bound.setDocumentDeletion(current.key, undefined);
          });
          return {};
        },
      })), input.atomic, repo);
    } else if (tool === 'document.summarize' || tool === 'document.translate' || tool === 'document.rewrite') {
      const items = tool === 'document.rewrite'
        ? input.rewrites
        : input.documentKeys.map((documentKey: string) => ({
          documentKey,
          mode: tool === 'document.translate' ? input.mode : input.persist ? 'copy' : 'preview',
        }));
      if (input.atomic && items.some((item: any) => item.mode !== 'preview')) fail('ARCHIVE_CONFLICT', 'Atomic persisted AI transformations are unavailable because generation and storage cannot be rolled back.', tool, 'reason');
      resourceKeys = items.map((item: any) => item.documentKey);

      if (tool === 'document.summarize' && input.combine) {
        const sourceDocuments = [];
        for (const key of input.documentKeys) sourceDocuments.push(await document(key, input.persist ? 'moderator' : 'viewer', false));
        const synthesis = await action('deep-reason', {
          instruction: `Synthesize one ${input.style ?? 'brief'} summary${input.language ? ` in ${input.language}` : ''} across all supplied documents.`,
          documents: sourceDocuments.map((item) => ({ title: item.name, content: item.content })),
        }, sourceDocuments[0]!.key, sourceDocuments[0]!.scopeKey);
        const text = z.string().trim().min(1).parse(synthesis.text);
        const persistedDocumentKey = input.persist ? await persistGenerated(sourceDocuments[0]!, text, 'copy', 'combined summary') : undefined;
        result = {
          results: sourceDocuments.map((item) => ({
            key: item.key,
            success: true,
            data: { documentKey: item.key, text, ...(persistedDocumentKey ? { persistedDocumentKey } : {}) },
          })),
          summary: { requested: sourceDocuments.length, succeeded: sourceDocuments.length, failed: 0 },
        };
      } else {
        result = await batch(tool, items.map((item: any) => ({
          key: item.documentKey,
          run: async () => {
            const current = await document(item.documentKey, item.mode === 'preview' ? 'viewer' : 'moderator', false);
            const instruction = tool === 'document.summarize'
              ? `Summarize in ${input.style ?? 'brief'} style${input.language ? ` in ${input.language}` : ''}.`
              : tool === 'document.translate'
                ? `Translate to ${input.targetLanguage}${input.sourceLanguage ? ` from ${input.sourceLanguage}` : ''}. ${input.preserveFormatting ? 'Preserve headings, lists, tables, paragraph boundaries, and inline emphasis.' : 'Return clear translated prose.'}`
                : `${item.instruction}${item.tone ? ` Tone: ${item.tone}.` : ''}${item.audience ? ` Audience: ${item.audience}.` : ''}${item.length ? ` Length: ${item.length}.` : ''}`;
            const text = await generated(current, instruction, tool === 'document.rewrite');
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
      }
    } else {
      const organizationSearch = tool === 'organization.document.search';
      if (organizationSearch && input.organizationKey !== context.organizationKey) fail('ARCHIVE_FORBIDDEN', 'Organization key does not match the execution context.', tool, 'authorization');
      const includeArchived = input.filters?.includeArchived === true;
      const allowed = await repo.allowedScopeKeys(context.organizationKey, member.userOrganization.key);
      if (!organizationSearch) await roleFor(input.scopeKey, 'viewer');

      const mapProjects = async (projectKeys: string[]) => {
        if (dependencies.projectScopeKeys) return dependencies.projectScopeKeys(projectKeys, context.organizationKey);
        const mapping: Record<string, string> = {};
        for (const key of projectKeys) {
          const scope = await repo.getScope(key);
          if (!scope || scope.organizationKey !== context.organizationKey) fail('ARCHIVE_SEARCH_INVALID_SOURCE', 'Project key does not identify a scope in this organization.', tool, 'resolution', key);
          mapping[key] = key;
        }
        return mapping;
      };
      const filterScopeKeys = new Set<string>(input.filters?.scopeKeys ?? allowed);
      if (input.filters?.projectKeys) {
        const mapped = await mapProjects(input.filters.projectKeys);
        const projectScopes = new Set(Object.values(mapped));
        for (const key of [...filterScopeKeys]) if (!projectScopes.has(key)) filterScopeKeys.delete(key);
      }
      const filterFolderKeys: string[] | undefined = input.filters?.folderKeys;
      if (filterFolderKeys) {
        for (const key of filterFolderKeys) await folder(key, 'viewer', includeArchived);
      }
      const sourceInputs = input.sources ?? [{ type: 'scope', scopeKeys: organizationSearch ? allowed : [input.scopeKey] }];
      const resolvedSources: Array<{ type: 'scope' | 'project' | 'folder'; key: string; scopeKeys: string[]; folderKeys?: string[] }> = [];
      for (const source of sourceInputs) {
        if (source.type === 'scope') {
          for (const key of source.scopeKeys) resolvedSources.push({ type: 'scope', key, scopeKeys: [key] });
        } else if (source.type === 'project') {
          const mapped = await mapProjects(source.projectKeys);
          for (const key of source.projectKeys) resolvedSources.push({ type: 'project', key, scopeKeys: [mapped[key]!] });
        } else {
          for (const key of source.folderKeys) {
            const current = await folder(key, 'viewer', includeArchived);
            if (!includeArchived && !await activeFolderHierarchy(key, current.scopeKey)) fail('FOLDER_ARCHIVED', 'Search folder hierarchy is archived.', tool, 'resolution', key);
            const children = source.includeDescendants ? descendants(await foldersIn(current.scopeKey), key) : [];
            const folderKeys = [key, ...children.filter((item) => includeArchived || !item.deletedAt).map((item) => item.key)];
            resolvedSources.push({ type: 'folder', key, scopeKeys: [current.scopeKey], folderKeys });
          }
        }
      }
      let embedding: number[];
      try { embedding = await embed(input.query); }
      catch (error) { fail('ARCHIVE_SEARCH_EMBEDDING_FAILED', 'Search query embedding failed.', tool, 'embed', undefined, error, true); }
      const candidates = new Map<string, { score: number; document: Document; source: { type: 'scope' | 'project' | 'folder'; key: string } }>();
      for (const source of resolvedSources) {
        const scopeKeys = source.scopeKeys.filter((key) => allowed.includes(key) && filterScopeKeys.has(key));
        if (scopeKeys.length === 0) continue;
        let folderKeys = source.folderKeys;
        if (filterFolderKeys) folderKeys = folderKeys ? folderKeys.filter((key) => filterFolderKeys.includes(key)) : filterFolderKeys;
        if (folderKeys?.length === 0) continue;
        const matches = await repo.semanticSearch({
          embedding,
          authorizedScopeKeys: scopeKeys,
          folderKeys,
          documentKeys: input.filters?.documentKeys,
          extensions: input.filters?.extensions,
          createdAfter: input.filters?.createdAfter,
          createdBefore: input.filters?.createdBefore,
          updatedAfter: input.filters?.updatedAfter,
          updatedBefore: input.filters?.updatedBefore,
          includeArchived,
          minScore: input.minimumScore,
          limit: input.topK ?? 20,
        });
        for (const match of matches) {
          if (match.document._internalDeletion) continue;
          if (!includeArchived && !await activeFolderHierarchy(match.document.folderKey, match.document.scopeKey)) continue;
          if (!includeArchived && match.document.deletedAt) continue;
          const previous = candidates.get(match.document.key);
          if (!previous || match.score > previous.score) candidates.set(match.document.key, { ...match, source: { type: source.type, key: source.key } });
        }
      }
      if (resolvedSources.length === 0 || candidates.size === 0 && !resolvedSources.some((source) => source.scopeKeys.some((key) => allowed.includes(key)))) fail('ARCHIVE_SEARCH_NO_ACCESSIBLE_SOURCES', 'No accessible Archive search source remains.', tool, 'authorization');
      const ranked = [...candidates.values()].sort((left, right) => right.score - left.score || left.document.key.localeCompare(right.document.key));
      const totalCandidates = ranked.length;
      const selected = ranked.slice(0, input.topK ?? 20);
      result = {
        query: input.query,
        results: await Promise.all(selected.map(async ({ score, document: current, source }) => {
          const normalizedScore = Math.max(0, Math.min(1, score));
          const parent = input.include?.includes('folder') ? await repo.getFolder(current.folderKey) : undefined;
          return {
            documentKey: current.key,
            name: current.name,
            scopeKey: current.scopeKey,
            folderKey: current.folderKey,
            score: normalizedScore,
            matchedSource: source,
            ...(input.include?.includes('snippet') ? { snippet: current.content.slice(0, 300) } : {}),
            ...(input.include?.includes('content') ? { content: current.content } : {}),
            ...(input.include?.includes('html') ? { html: current.html } : {}),
            ...(parent ? { folder: folderView(parent) } : {}),
            ...(input.include?.includes('scope') ? { scope: { key: current.scopeKey } } : {}),
            ...(input.include?.includes('scoreBreakdown') ? { scoreBreakdown: { vector: normalizedScore, final: normalizedScore } } : {}),
          };
        })),
        totalCandidates,
      };
    }
    const parsed = archiveToolOutputSchemas[tool].parse(result) as ArchiveToolOutput<Name>;
    executionCompleted = true;
    if (idempotencyIdentity && requestHash && ownsIdempotencyClaim) await d.idempotency.complete(idempotencyIdentity, requestHash, invocationKey, parsed, now());
    if (mutation) { const success = !(parsed && typeof parsed === 'object' && 'summary' in parsed && (parsed as { summary?: { failed?: number } }).summary?.failed); try { await d.audit({ tool, success, organizationKey: context.organizationKey, scopeKey: context.runtimeScopeKey, actorKey: member.user.key, resourceKeys: resourceKeys.filter((key) => key !== 'new'), ...(!success ? { code: 'ARCHIVE_BATCH_PARTIAL_FAILURE' } : {}) }); } catch { await event('audit', 'failed'); } }
    await event('action', 'succeeded', 'tool', undefined, context.runtimeScopeKey, Math.round(performance.now() - invocationStarted));
    return parsed;
  } catch (error) {
    const mapped = mappedError(error, tool);
    if (idempotencyIdentity && requestHash && ownsIdempotencyClaim && !executionCompleted) await d.idempotency.release(idempotencyIdentity, requestHash, invocationKey).catch(() => undefined);
    if (mutation) { try { await d.audit({ tool, success: false, organizationKey: context.organizationKey, scopeKey: context.runtimeScopeKey, actorKey: member.user.key, resourceKeys: resourceKeys.filter((key) => key !== 'new'), code: mapped.code }); } catch { await event('audit', 'failed'); } }
    await event('action', 'failed', 'tool', mapped.resourceKey, context.runtimeScopeKey, Math.round(performance.now() - invocationStarted));
    throw mapped;
  }
}
