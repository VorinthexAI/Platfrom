import { createHash } from 'node:crypto';
import { z } from 'zod';
import { contentZodToJsonSchema } from '@/lib/ai/tools/content-json-schema';
import { runContentTool } from '@/lib/ai/tools/content-runtime';
import type { ContentToolName } from '@/lib/ai/tools/content-schemas';
import { createTravelService } from '@/lib/travel/service';
import { createEmailService, type EmailActor } from '@/lib/email-inbox/service';
import { defaultBookService } from '@/lib/books/default-service';
import { newId } from '@/lib/ids';
import { userHiddenOperations } from '@/lib/user-hiddens/operations';
import type { AssistantCapability, AssistantCapabilityContext } from './capabilities';

const key = z.string().cuid();
const name = z.string().trim().min(1).max(255);

function identity(context: AssistantCapabilityContext) {
  const { domain } = context;
  if (domain.principal.kind !== 'member') throw new Error('A member principal is required for personal assistant capabilities.');
  if (domain.principal.userOrganization.organizationId !== domain.organizationKey || domain.principal.userOrganization.status !== 'active') throw new Error('Active organization membership is required.');
  const serviceContext = { organizationKey: domain.organizationKey, scopeKey: domain.runtimeScopeKey };
  return {
    userKey: domain.principal.user.key,
    serviceContext,
    emailActor: { userKey: domain.principal.user.key, ...serviceContext } satisfies EmailActor,
  };
}

function capability<Schema extends z.ZodTypeAny>(name: string, description: string, schema: Schema, execute: (input: z.output<Schema>, context: AssistantCapabilityContext) => Promise<unknown>, mutationWorkspace?: AssistantCapability['mutationWorkspace']): AssistantCapability<Schema> {
  return {
    inputSchema: schema,
    mutationWorkspace,
    definition: { name, description, inputSchema: contentZodToJsonSchema(schema) },
    async execute(rawInput, context) {
      return { kind: 'continue', result: await execute(schema.parse(rawInput), context) };
    },
  };
}

function archive<Schema extends z.ZodTypeAny>(name: string, description: string, schema: Schema, tool: ContentToolName, transform: (input: z.output<Schema>, context: AssistantCapabilityContext) => Record<string, unknown>, mutation = false) {
  return capability(name, description, schema, async (input, context) => {
    const canonicalInput = transform(input, context);
    if (mutation) {
      const requestKey = context.requestKey ?? createHash('sha256').update(JSON.stringify({ organizationKey: context.domain.organizationKey, scopeKey: context.domain.runtimeScopeKey, name, input: canonicalInput })).digest('hex');
      canonicalInput.idempotencyKey = `${requestKey}:${name}`;
    }
    return (context.executeContent ?? runContentTool)(tool as never, canonicalInput, context.domain, context.contentDependencies);
  }, mutation ? 'archive' : undefined);
}

function currentDocumentKey(documentKey: string | undefined, context: AssistantCapabilityContext) {
  const resolved = documentKey ?? context.currentDocumentKey;
  if (!resolved) throw new Error('Open or identify an Archive document before using this action.');
  return resolved;
}

function hiddenContext(context: AssistantCapabilityContext) {
  const principal = context.domain.principal;
  if (principal.kind !== 'member') throw new Error('A member principal is required.');
  if (principal.userOrganization.status !== 'active' || principal.userOrganization.organizationId !== context.domain.organizationKey || principal.userOrganization.userId !== principal.user.key) {
    throw new Error('An active matching organization membership is required.');
  }
  return { userKey: principal.user.key, organizationKey: context.domain.organizationKey, membershipKey: principal.userOrganization.key, service: context.userHiddens };
}

function hiddenCapability(source: 'folder' | 'document', operation: 'hide' | 'reveal') {
  return capability(`${source}.${operation}`, `${operation === 'hide' ? 'Hide' : 'Reveal'} an accessible Archive ${source} for the current user.`, z.object({ sourceKey: key }).strict(), async ({ sourceKey }, context) => userHiddenOperations[operation]({ source, sourceKey }, hiddenContext(context)), 'archive');
}

export const hiddenListCapability = capability('content.hidden.list', 'List content hidden by the current user across Archive and Gallery.', z.object({}).strict(), async (_input, context) => {
  const rows = await userHiddenOperations.list({}, hiddenContext(context));
  return { items: rows.map(({ key, source, sourceKey, createdAt }) => ({ key, source, sourceKey, createdAt })) };
});

export const archiveCapabilities = [
  hiddenCapability('folder', 'hide'),
  hiddenCapability('folder', 'reveal'),
  hiddenCapability('document', 'hide'),
  hiddenCapability('document', 'reveal'),
  archive('folder.list', 'List direct Archive folders or all descendants under the root or a parent folder.', z.object({ parentFolderKey: key.optional(), includeDescendants: z.boolean().optional(), includeDocuments: z.boolean().optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }).strict(), 'folder.list', (input, context) => ({ scopeKey: context.domain.runtimeScopeKey, ...input })),
  archive('folder.create', 'Create a folder in Archive. Use this whenever the user asks to create or add a folder.', z.object({ name, parentFolderKey: key.optional(), description: z.string().trim().min(1).max(10_000).optional() }).strict(), 'folder.create', (input, context) => ({ folders: [{ scopeKey: context.domain.runtimeScopeKey, ...input }] }), true),
  archive('folder.update', 'Update the metadata or favorite state of an Archive folder.', z.object({ folderKey: key, name: name.optional(), description: z.string().trim().min(1).max(10_000).nullable().optional(), isFavorite: z.boolean().optional() }).strict().refine(({ name, description, isFavorite }) => name !== undefined || description !== undefined || isFavorite !== undefined), 'folder.update', (input) => ({ updates: [input] }), true),
  archive('folder.move', 'Move an Archive folder under another folder, or omit the target to move it to the root.', z.object({ folderKey: key, targetParentFolderKey: key.optional() }).strict(), 'folder.move', (input) => ({ moves: [input] }), true),
  archive('folder.copy', 'Copy selected Archive folder subtrees to one or more parent folders.', z.object({ copies: z.array(z.object({ folderKey: key, targetParentFolderKey: key.optional(), newName: name.optional() }).strict()).min(1).max(100) }).strict(), 'folder.copy', ({ copies }, context) => ({ copies: copies.map((copy) => ({ ...copy, targetScopeKey: context.domain.runtimeScopeKey })) }), true),
  archive('document.list', 'List Archive documents at the root or in a folder.', z.object({ folderKey: key.optional(), limit: z.number().int().min(1).max(100).optional() }).strict(), 'document.list', (input, context) => ({ scopeKey: context.domain.runtimeScopeKey, ...input })),
  archive('document.find', 'Find an Archive document by key.', z.object({ documentKey: key, includeContent: z.boolean().optional() }).strict(), 'document.find', ({ documentKey, includeContent }) => ({ documentKeys: [documentKey], ...(includeContent ? { include: ['content'] } : {}) })),
  archive('document.create', 'Create a text document in Archive.', z.object({ name, content: z.string().max(40_000), folderKey: key.optional() }).strict(), 'document.create', ({ name, content, folderKey }, context) => ({ scopeKey: context.domain.runtimeScopeKey, name, content, ...(folderKey ? { folderKey } : {}) }), true),
  archive('document.update', 'Update complete text content or favorite state of an Archive document.', z.object({ documentKey: key, content: z.string().max(40_000).optional(), isFavorite: z.boolean().optional(), createVersion: z.boolean().optional() }).strict().refine(({ content, isFavorite }) => content !== undefined || isFavorite !== undefined), 'document.update', (input) => ({ updates: [input] }), true),
  archive('document.rename', 'Rename an Archive document.', z.object({ documentKey: key, name }).strict(), 'document.rename', (input) => ({ renames: [input] }), true),
  archive('document.move', 'Move an Archive document to a folder or the Archive root.', z.object({ documentKey: key, targetFolderKey: key.optional() }).strict(), 'document.move', (input, context) => ({ moves: [{ ...input, targetScopeKey: context.domain.runtimeScopeKey }] }), true),
  archive('document.copy', 'Copy an Archive document to a folder or the Archive root.', z.object({ documentKey: key, targetFolderKey: key.optional(), newName: name.optional(), includeVersions: z.boolean().optional() }).strict(), 'document.copy', (input, context) => ({ copies: [{ ...input, targetScopeKey: context.domain.runtimeScopeKey }] }), true),
  archive('document.summarize', 'Create and save an immutable summary of the open Archive document, or an explicitly identified document.', z.object({ documentKey: key.optional(), topic: z.string().trim().min(1).max(500).optional(), style: z.enum(['brief', 'detailed', 'executive', 'bullet-points', 'technical']).optional(), language: z.string().trim().min(1).max(100).optional() }).strict(), 'document.summarize', ({ documentKey, ...input }, context) => ({ documentKeys: [currentDocumentKey(documentKey, context)], ...input, persist: true }), true),
  archive('document.topics', 'Identify up to ten concise topics in the open Archive document, or an explicitly identified document.', z.object({ documentKey: key.optional() }).strict(), 'document.topics', ({ documentKey }, context) => ({ documentKey: currentDocumentKey(documentKey, context) })),
  archive('document.list-summaries', 'List saved summaries of the open Archive document, or an explicitly identified document.', z.object({ documentKey: key.optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }).strict(), 'document.list-summaries', ({ documentKey, ...input }, context) => ({ documentKeys: [currentDocumentKey(documentKey, context)], ...input })),
  archive('document.find-summary', 'Open one saved Archive document summary by key.', z.object({ summaryKey: key }).strict(), 'document.find-summary', ({ summaryKey }) => ({ summaryKeys: [summaryKey] })),
  archive('document.audio.playback.update', 'Select an Archive document audio version and save its playback position.', z.object({ audioVersionKey: key, playbackPositionMs: z.number().int().nonnegative() }).strict(), 'document.audio.playback.update', (input) => input, true),
  archive('document.audio.playback.clear', 'Dismiss the selected audio version for an Archive document.', z.object({ documentKey: key }).strict(), 'document.audio.playback.clear', (input) => input, true),
  archive('document.enhance', 'Enhance the open Archive document, or an explicitly identified document, in place while preserving meaning and formatting.', z.object({ documentKey: key.optional() }).strict(), 'document.enhance', ({ documentKey }, context) => ({ documentKeys: [currentDocumentKey(documentKey, context)], mode: 'replace' }), true),
  archive('document.translate', 'Translate the open Archive document, or an explicitly identified document, in place while preserving formatting.', z.object({ documentKey: key.optional(), targetLanguage: z.string().trim().min(2).max(100) }).strict(), 'document.translate', ({ documentKey, targetLanguage }, context) => ({ documentKeys: [currentDocumentKey(documentKey, context)], targetLanguage, preserveFormatting: true, mode: 'replace' }), true),
  archive('document.list-versions', 'List saved versions of the open Archive document, or an explicitly identified document.', z.object({ documentKey: key.optional(), limit: z.number().int().min(1).max(100).optional() }).strict(), 'document.list-versions', ({ documentKey, ...input }, context) => ({ documentKeys: [currentDocumentKey(documentKey, context)], ...input })),
  archive('document.restore-version', 'Restore one saved version of the open Archive document, or an explicitly identified document, and preserve the current content as a backup version.', z.object({ documentKey: key.optional(), versionKey: key }).strict(), 'document.restore-version', ({ documentKey, versionKey }, context) => ({ restores: [{ documentKey: currentDocumentKey(documentKey, context), versionKey, createBackupVersion: true }] }), true),
  archive('document.download', 'Download an Archive document as its original file or plain text.', z.object({ documentKey: key, format: z.enum(['original', 'txt']).optional() }).strict(), 'document.download', ({ documentKey, ...input }) => ({ documentKeys: [documentKey], ...input })),
  archive('content.neighbors', 'Find semantically similar active folders, documents, and files for an Archive folder or document.', z.object({ folderKey: key.optional(), documentKey: key.optional() }).strict().refine((input) => Number(input.folderKey !== undefined) + Number(input.documentKey !== undefined) === 1, 'exactly one source key is required'), 'content.neighbors', (input) => input),
  archive('content.search-history.delete', 'Delete one entry from the current user\'s global search history.', z.object({ normalizedQuery: z.string().trim().min(1).max(12_000) }).strict(), 'content.search-history.delete', (input, context) => ({ scopeKey: context.domain.runtimeScopeKey, ...input }), true),
];

export const compassCapabilities = [
  capability('place.list', 'List saved cities.', z.object({}).strict(), async (_input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).overview(actor.serviceContext, actor.userKey); }),
];

export const signalCapabilities = [
  capability('email.overview', 'List and search Signal email threads.', z.object({ filter: z.enum(['all', 'important', 'urgent', 'needs_action', 'filtered', 'unread', 'favorite']).optional(), search: z.string().trim().max(200).optional() }).strict(), async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).overview(actor.emailActor, input); }),
  capability('email.sync', 'Synchronize the connected Signal email inbox.', z.object({}).strict(), async (_input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).sync(actor.emailActor); }, 'signal'),
  capability('email.thread.read', 'Read up to 50 Signal email messages without changing unread state. Message bodies are limited to 8,000 characters each and 64,000 characters total; truncation and a continuation cursor are returned explicitly.', z.object({ threadKey: key, cursor: z.string().min(1).max(2_000).optional() }).strict(), async ({ threadKey, cursor }, context) => { const actor = identity(context); return (context.email ?? createEmailService()).threadForTool(actor.emailActor, threadKey, cursor); }),
  capability('email.thread.mark-read', 'Mark a Signal email thread as read and return the same bounded first-page projection as email.thread.read.', z.object({ threadKey: key }).strict(), async ({ threadKey }, context) => { const actor = identity(context); return (context.email ?? createEmailService()).markRead(actor.emailActor, threadKey); }, 'signal'),
  capability('email.thread.favorite', 'Set or clear the favorite state of a Signal email thread.', z.object({ threadKey: key, isFavorite: z.boolean() }).strict(), async ({ threadKey, isFavorite }, context) => { const actor = identity(context); return (context.email ?? createEmailService()).setFavorite(actor.emailActor, threadKey, isFavorite); }, 'signal'),
  capability('email.draft.create', 'Generate a reply draft for a Signal email thread without sending it.', z.object({ threadKey: key, tone: z.enum(['concise', 'warm', 'formal', 'direct']), instruction: z.string().trim().max(1_000).optional(), profileKey: key.optional() }).strict(), async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).draft(actor.emailActor, input); }, 'signal'),
  capability('email.draft.update', 'Replace the final content of a Signal reply draft without sending it.', z.object({ draftKey: key, finalContent: z.string().trim().min(1).max(50_000) }).strict(), async ({ draftKey, finalContent }, context) => { const actor = identity(context); return (context.email ?? createEmailService()).updateDraft(actor.emailActor, draftKey, finalContent); }, 'signal'),
  capability('email.draft.send', 'Send a reviewed Signal email reply draft.', z.object({ draftKey: key }).strict(), async ({ draftKey }, context) => { const actor = identity(context); return (context.email ?? createEmailService()).sendDraft(actor.emailActor, draftKey); }, 'signal'),
  capability('email.disconnect', 'Disconnect Signal from Gmail only when the user explicitly asks to disconnect the account.', z.object({}).strict(), async (_input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).disconnect(actor.emailActor); }, 'signal'),
];

export const ascendCapabilities = [
  capability('book.list', 'List Ascend books and reading progress.', z.object({}).strict(), async (_input, context) => { const actor = identity(context); return (context.books ?? defaultBookService).overview(actor.serviceContext, actor.userKey); }),
  capability('book.detail', 'Read an Ascend book, chapters, and progress.', z.object({ bookKey: key }).strict(), async ({ bookKey }, context) => { const actor = identity(context); return (context.books ?? defaultBookService).detail(bookKey, actor.serviceContext, actor.userKey); }),
  capability('book.chapter.progress', 'Update progress for an Ascend chapter.', z.object({ bookKey: key, chapterKey: key, progressSeconds: z.number().int().nonnegative(), isCompleted: z.boolean() }).strict(), async ({ bookKey, chapterKey, ...input }, context) => { const actor = identity(context); return (context.books ?? defaultBookService).progress(bookKey, chapterKey, { ...actor.serviceContext, ...input }, actor.userKey); }, 'ascend'),
  capability('book.create', 'Create and fully generate a personalized book after the user explicitly asks for one.', z.object({ topic: z.string().trim().min(3).max(500), goal: z.string().trim().min(3).max(1_000), audience: z.string().trim().min(2).max(500), tone: z.string().trim().min(2).max(200), length: z.enum(['short', 'standard', 'deep']), language: z.string().trim().min(2).max(100), sourceNotes: z.string().trim().min(1).max(12_000).optional() }).strict(), async (input, context) => {
    const actor = identity(context);
    const requestKey = ('clientRequestKey' in context ? context.clientRequestKey : context.requestKey)?.trim();
    const generationRequestKey = !requestKey ? newId() : requestKey.length <= 200 ? requestKey : createHash('sha256').update(requestKey).digest('hex');
    return (context.books ?? defaultBookService).create({ ...actor.serviceContext, generationRequestKey, ...input }, actor.userKey);
  }, 'ascend'),
];
