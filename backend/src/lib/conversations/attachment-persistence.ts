import { z } from 'zod';
import { CORE_CHAT_DOCUMENT_MIME_TYPES, CORE_CHAT_IMAGE_MIME_TYPES, CORE_CHAT_MAX_FILE_BYTES_TOTAL } from '@/lib/ai/actions/core-chat';
import { parseDocument, documentStorage, type DocumentObjectStorage, type DocumentParseDependencies } from '@/lib/ai/document-processing';
import { ingestGalleryLibraryUpload, type GalleryUploadProcessingDependencies } from '@/lib/gallery/upload-processing';
import { evaluateScopeAccess } from '@/lib/ai/tools/domain-access-engine';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contentPersistence } from '@/lib/db/content-persistence.node';
import { embedText } from '@/lib/embeddings';
import { getDefaultGalleryRepository, type GalleryRepository } from '@/lib/gallery/repository';
import { initialWorkspaceFolderKey } from '@/lib/initial-workspace-content-identifiers';
import { conversationAttachmentReferenceSchema, type ConversationAttachmentReference } from './schemas';
import { artifactSha256, conversationAttachmentArtifactSchema, type ConversationAttachmentArtifact } from './attachment-artifacts';

export type CoreAttachment =
  | { kind: 'document'; filename: string; mimeType: typeof CORE_CHAT_DOCUMENT_MIME_TYPES[number]; bytes: Uint8Array }
  | { kind: 'image'; filename: string; mimeType: typeof CORE_CHAT_IMAGE_MIME_TYPES[number]; bytes: Uint8Array };

export interface ConversationAttachmentPersistenceDependencies {
  storage?: Pick<DocumentObjectStorage, 'download' | 'delete'>;
  authorize?: typeof evaluateScopeAccess;
  parse?: typeof parseDocument;
  document?: DocumentParseDependencies;
  ingestGalleryUpload?: typeof ingestGalleryLibraryUpload;
  image?: GalleryUploadProcessingDependencies;
  gallery?: Pick<GalleryRepository, 'ensureGeneratedMediaCollection'>;
  embedCollection?: typeof embedText;
  now?: () => string;
  signal?: AbortSignal;
}

function trustedArtifacts(records: readonly ConversationAttachmentArtifact[], context: ToolContext) {
  const principal = context.principal;
  if (principal.kind !== 'member' || principal.userTeam.status !== 'active' || principal.userTeam.teamKey !== context.teamKey || principal.userTeam.userId !== principal.user.key) throw new Error('Conversation attachment persistence requires an active matching member identity.');
  const identity = z.object({ teamKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(), userKey: z.string().cuid(), actorKey: z.string().cuid() }).strict().parse({ teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, userKey: principal.user.key, actorKey: principal.userTeam.key });
  const artifacts = records.map((record) => conversationAttachmentArtifactSchema.parse(record));
  if (artifacts.some((record) => !['CLAIMED', 'PROCESSING'].includes(record.status) || record.teamKey !== identity.teamKey || record.scopeKey !== identity.scopeKey || record.userKey !== identity.userKey || record.ownerKey !== identity.actorKey)) throw new Error('Claimed conversation attachments do not belong to the trusted execution context.');
  return { identity, artifacts };
}

async function authorizeArtifacts(identity: { teamKey: string; scopeKey: string; userKey: string; actorKey: string }, context: ToolContext, authorize: typeof evaluateScopeAccess) {
  const decision = await authorize(context, { scope: identity.scopeKey, action: 'read' });
  if (!decision.allowed || decision.scope.key !== identity.scopeKey || decision.scope.teamKey !== identity.teamKey || decision.teamDecision.membership?.key !== identity.actorKey || decision.teamDecision.membership.userId !== identity.userKey) throw new Error('Conversation attachment persistence requires active scope access.');
}

export async function prepareConversationAttachments(records: readonly ConversationAttachmentArtifact[], context: ToolContext, dependencies: Pick<ConversationAttachmentPersistenceDependencies, 'storage' | 'authorize'> = {}): Promise<CoreAttachment[]> {
  const { identity, artifacts } = trustedArtifacts(records, context);
  await authorizeArtifacts(identity, context, dependencies.authorize ?? evaluateScopeAccess);
  if (artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0) > CORE_CHAT_MAX_FILE_BYTES_TOTAL) throw new Error('Conversation attachment bytes exceed the aggregate request limit.');
  const storage = dependencies.storage ?? documentStorage;
  const prepared = await Promise.all(artifacts.map(async (artifact) => {
    const object = await storage.download(artifact.stagedStorageKey);
    if (object.bytes.byteLength !== artifact.sizeBytes || artifactSha256(object.bytes) !== artifact.stagedSha256) throw new Error('A claimed conversation attachment is unavailable.');
    return artifact.kind === 'document'
      ? { kind: 'document' as const, filename: artifact.filename, mimeType: z.enum(CORE_CHAT_DOCUMENT_MIME_TYPES).parse(artifact.mimeType), bytes: object.bytes }
      : { kind: 'image' as const, filename: artifact.filename, mimeType: z.enum(CORE_CHAT_IMAGE_MIME_TYPES).parse(artifact.mimeType), bytes: object.bytes };
  }));
  return prepared;
}

export async function persistConversationAttachment(record: ConversationAttachmentArtifact, context: ToolContext, dependencies: ConversationAttachmentPersistenceDependencies = {}): Promise<ConversationAttachmentReference> {
  const { identity, artifacts: [artifact] } = trustedArtifacts([record], context);
  await authorizeArtifacts(identity, context, dependencies.authorize ?? evaluateScopeAccess);
  const storage = dependencies.storage ?? documentStorage;
  const object = await storage.download(artifact!.stagedStorageKey);
  if (object.bytes.byteLength !== artifact!.sizeBytes || artifactSha256(object.bytes) !== artifact!.stagedSha256) throw new Error('A claimed conversation attachment is unavailable.');
  if (artifact!.kind === 'document') {
    const parsed = await (dependencies.parse ?? parseDocument)({ file: { filename: artifact!.filename, mimeType: artifact!.mimeType, sizeBytes: artifact!.sizeBytes, bytes: object.bytes }, scopeKey: identity.scopeKey, folderKey: initialWorkspaceFolderKey(identity.scopeKey, 'assistant'), idempotencyKey: `conversation-attachment:${artifact!.key}` }, { ...dependencies.document, teamKey: identity.teamKey, signal: dependencies.signal, insert: (document) => contentPersistence.insertConversationAttachmentDocument(document, identity.actorKey) });
    return conversationAttachmentReferenceSchema.parse({ key: parsed.document.key, kind: 'document', ...(artifact!.displayKey ? { displayKey: artifact!.displayKey } : {}), filename: artifact!.filename, mimeType: artifact!.mimeType, sizeBytes: artifact!.sizeBytes });
  }
  const gallery = dependencies.gallery ?? getDefaultGalleryRepository();
  const now = dependencies.now ?? (() => new Date().toISOString());
  const collection = await gallery.ensureGeneratedMediaCollection(identity.scopeKey, identity.actorKey, await (dependencies.embedCollection ?? embedText)({ text: 'Core', purpose: 'document' }), now());
  if (!collection) throw new Error('Conversation image attachment destination is unavailable.');
  const jpeg = artifact!.mimeType === 'image/jpeg';
  const image = await (dependencies.ingestGalleryUpload ?? ingestGalleryLibraryUpload)({
    teamKey: identity.teamKey, scopeKey: identity.scopeKey, actorKey: identity.actorKey, userKey: identity.userKey, collectionKey: collection.key,
    filename: artifact!.filename, mimeType: jpeg ? 'image/jpeg' : 'image/png', bytes: object.bytes, imageKey: artifact!.key,
  }, dependencies.image);
  if (!image || image.mimeType !== 'image/png') throw new Error('Conversation image attachment was not persisted as canonical PNG media.');
  return conversationAttachmentReferenceSchema.parse({ key: image.key, kind: 'image', ...(artifact!.displayKey ? { displayKey: artifact!.displayKey } : {}), filename: image.filename, mimeType: 'image/png', sizeBytes: image.sizeBytes, width: image.width, height: image.height });
}
