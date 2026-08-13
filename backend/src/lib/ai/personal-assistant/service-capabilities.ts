import { createHash } from 'node:crypto';
import { z } from 'zod';
import { contentZodToJsonSchema } from '@/lib/ai/tools/content-json-schema';
import { runContentTool } from '@/lib/ai/tools/content-runtime';
import type { ContentToolName } from '@/lib/ai/tools/content-schemas';
import { createTravelService } from '@/lib/travel/service';
import { createEmailService, type EmailActor } from '@/lib/email-inbox/service';
import { createBookService } from '@/lib/books/service';
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

export const archiveCapabilities = [
  archive('archive_folder_list', 'List Archive folders under the root or a parent folder.', z.object({ parentFolderKey: key.optional(), includeArchived: z.boolean().optional(), includeDocuments: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional() }).strict(), 'folder.list', (input, context) => ({ scopeKey: context.domain.runtimeScopeKey, ...input })),
  archive('archive_folder_create', 'Create a folder in Archive. Use this whenever the user asks to create or add a folder.', z.object({ name, parentFolderKey: key.optional(), description: z.string().trim().min(1).max(10_000).optional() }).strict(), 'folder.create', (input, context) => ({ folders: [{ scopeKey: context.domain.runtimeScopeKey, ...input }] }), true),
  archive('archive_folder_update', 'Update the name or description of an Archive folder.', z.object({ folderKey: key, name: name.optional(), description: z.string().trim().min(1).max(10_000).nullable().optional() }).strict().refine(({ name, description }) => name !== undefined || description !== undefined), 'folder.update', (input) => ({ updates: [input] }), true),
  archive('archive_folder_move', 'Move an Archive folder under another folder, or omit the target to move it to the root.', z.object({ folderKey: key, targetParentFolderKey: key.optional() }).strict(), 'folder.move', (input) => ({ moves: [input] }), true),
  archive('archive_document_list', 'List Archive documents at the root or in a folder.', z.object({ folderKey: key.optional(), includeArchived: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional() }).strict(), 'document.list', (input, context) => ({ scopeKey: context.domain.runtimeScopeKey, ...input })),
  archive('archive_document_find', 'Find an Archive document by key.', z.object({ documentKey: key, includeArchived: z.boolean().optional(), includeContent: z.boolean().optional() }).strict(), 'document.find', ({ documentKey, includeContent, ...input }) => ({ documentKeys: [documentKey], ...input, ...(includeContent ? { include: ['content'] } : {}) })),
  archive('archive_document_create', 'Create a text document in Archive.', z.object({ name, content: z.string().max(40_000), folderKey: key.optional() }).strict(), 'document.create', ({ name, content, folderKey }, context) => ({ scopeKey: context.domain.runtimeScopeKey, name, representation: { content }, ...(folderKey ? { folderKey } : {}) }), true),
  archive('archive_document_update', 'Update complete text content or favorite state of an Archive document.', z.object({ documentKey: key, content: z.string().max(40_000).optional(), isFavorite: z.boolean().optional(), createVersion: z.boolean().optional() }).strict().refine(({ content, isFavorite }) => content !== undefined || isFavorite !== undefined), 'document.update', (input) => ({ updates: [input] }), true),
  archive('archive_document_rename', 'Rename an Archive document.', z.object({ documentKey: key, name }).strict(), 'document.rename', (input) => ({ renames: [input] }), true),
  archive('archive_document_move', 'Move an Archive document to a folder or the Archive root.', z.object({ documentKey: key, targetFolderKey: key.optional() }).strict(), 'document.move', (input, context) => ({ moves: [{ ...input, targetScopeKey: context.domain.runtimeScopeKey }] }), true),
  archive('archive_document_copy', 'Copy an Archive document to a folder or the Archive root.', z.object({ documentKey: key, targetFolderKey: key.optional(), newName: name.optional(), includeVersions: z.boolean().optional() }).strict(), 'document.copy', (input, context) => ({ copies: [{ ...input, targetScopeKey: context.domain.runtimeScopeKey }] }), true),
  archive('archive_document_translate', 'Translate an Archive document in place while preserving formatting.', z.object({ documentKey: key, targetLanguage: z.string().trim().min(2).max(100) }).strict(), 'document.translate', ({ documentKey, targetLanguage }) => ({ documentKeys: [documentKey], targetLanguage, preserveFormatting: true, mode: 'replace' }), true),
  archive('archive_document_versions', 'List saved versions of an Archive document.', z.object({ documentKey: key, limit: z.number().int().min(1).max(100).optional() }).strict(), 'document.list-versions', ({ documentKey, ...input }) => ({ documentKeys: [documentKey], ...input })),
  archive('archive_document_version_restore', 'Restore one saved version of an Archive document and preserve the current content as a backup version.', z.object({ documentKey: key, versionKey: key }).strict(), 'document.restore-version', ({ documentKey, versionKey }) => ({ restores: [{ documentKey, versionKey, createBackupVersion: true }] }), true),
  archive('archive_document_download', 'Download an Archive document as its original file or plain text.', z.object({ documentKey: key, format: z.enum(['original', 'txt']).optional() }).strict(), 'document.download', ({ documentKey, ...input }) => ({ documentKeys: [documentKey], ...input })),
];

const serviceText = z.string().trim().min(1).max(500).optional();
export const compassCapabilities = [
  capability('compass_overview', 'List saved places, visits, trips, and itineraries.', z.object({}).strict(), async (_input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).overview(actor.serviceContext, actor.userKey); }),
  capability('compass_place_create', 'Create a saved place in Compass.', z.object({ kind: z.enum(['country', 'place']).optional(), name: z.string().trim().min(1).max(200), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), countryCode: z.string().trim().length(2), country: serviceText, continent: serviceText, region: serviceText, city: serviceText, wishlist: z.boolean().optional() }).strict(), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).createPlace({ ...actor.serviceContext, ...input }, actor.userKey); }, 'compass'),
  capability('compass_visit_create', 'Record a visit to a saved Compass place.', z.object({ placeKey: key, tripKey: key.optional(), arrivedAt: z.string().date().optional(), departedAt: z.string().date().optional() }).strict(), async ({ placeKey, ...input }, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).createVisit(placeKey, { ...actor.serviceContext, ...input }, actor.userKey); }, 'compass'),
  capability('compass_trip_create', 'Create a Compass trip.', z.object({ name: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(2_000).optional(), startDate: z.string().date().optional(), endDate: z.string().date().optional() }).strict(), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).createTrip({ ...actor.serviceContext, ...input }, actor.userKey); }, 'compass'),
  capability('compass_trip_place_add', 'Add a saved place to a Compass trip.', z.object({ tripKey: key, placeKey: key, arrivalDate: z.string().date().optional(), departureDate: z.string().date().optional() }).strict(), async ({ tripKey, ...input }, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).appendPlace(tripKey, { ...actor.serviceContext, ...input }, actor.userKey); }, 'compass'),
  capability('compass_trip_place_remove', 'Remove a saved place from a Compass trip.', z.object({ tripKey: key, placeKey: key }).strict(), async ({ tripKey, placeKey }, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).removePlace(tripKey, placeKey, actor.serviceContext, actor.userKey); }, 'compass'),
];

export const signalCapabilities = [
  capability('signal_overview', 'List and search Signal email threads.', z.object({ filter: z.enum(['all', 'important', 'urgent', 'needs_action', 'filtered', 'unread', 'favorite']).optional(), search: z.string().trim().max(200).optional() }).strict(), async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).overview(actor.emailActor, input); }),
  capability('signal_sync', 'Synchronize the connected Signal email inbox.', z.object({}).strict(), async (_input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).sync(actor.emailActor); }, 'signal'),
  capability('signal_thread', 'Read a Signal email thread and its messages.', z.object({ threadKey: key, markRead: z.boolean().optional() }).strict(), async ({ threadKey, markRead }, context) => { const actor = identity(context); return (context.email ?? createEmailService()).thread(actor.emailActor, threadKey, markRead); }),
  capability('signal_favorite', 'Set or clear the favorite state of a Signal email thread.', z.object({ threadKey: key, isFavorite: z.boolean() }).strict(), async ({ threadKey, isFavorite }, context) => { const actor = identity(context); return (context.email ?? createEmailService()).setFavorite(actor.emailActor, threadKey, isFavorite); }, 'signal'),
  capability('signal_draft', 'Generate a reply draft for a Signal email thread without sending it.', z.object({ threadKey: key, tone: z.enum(['concise', 'warm', 'formal', 'direct']), instruction: z.string().trim().max(1_000).optional(), profileKey: key.optional() }).strict(), async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).draft(actor.emailActor, input); }, 'signal'),
  capability('signal_draft_update', 'Replace the final content of a Signal reply draft without sending it.', z.object({ draftKey: key, finalContent: z.string().trim().min(1).max(50_000) }).strict(), async ({ draftKey, finalContent }, context) => { const actor = identity(context); return (context.email ?? createEmailService()).updateDraft(actor.emailActor, draftKey, finalContent); }, 'signal'),
  capability('signal_draft_send', 'Send a reviewed Signal email reply draft.', z.object({ draftKey: key }).strict(), async ({ draftKey }, context) => { const actor = identity(context); return (context.email ?? createEmailService()).sendDraft(actor.emailActor, draftKey); }, 'signal'),
  capability('signal_disconnect', 'Disconnect Signal from Gmail only when the user explicitly asks to disconnect the account.', z.object({}).strict(), async (_input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).disconnect(actor.emailActor); }, 'signal'),
];

export const ascendCapabilities = [
  capability('ascend_overview', 'List Ascend books and reading progress.', z.object({}).strict(), async (_input, context) => { const actor = identity(context); return (context.books ?? createBookService()).overview(actor.serviceContext, actor.userKey); }),
  capability('ascend_detail', 'Read an Ascend book, chapters, and progress.', z.object({ bookKey: key }).strict(), async ({ bookKey }, context) => { const actor = identity(context); return (context.books ?? createBookService()).detail(bookKey, actor.serviceContext, actor.userKey); }),
  capability('ascend_progress', 'Update progress for an Ascend chapter.', z.object({ bookKey: key, chapterKey: key, progressSeconds: z.number().int().nonnegative(), isCompleted: z.boolean() }).strict(), async ({ bookKey, chapterKey, ...input }, context) => { const actor = identity(context); return (context.books ?? createBookService()).progress(bookKey, chapterKey, { ...actor.serviceContext, ...input }, actor.userKey); }, 'ascend'),
];
