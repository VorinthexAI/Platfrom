import { createHash } from 'node:crypto';
import { z } from 'zod';
import { contentZodToJsonSchema } from '@/lib/ai/tools/content-json-schema';
import { runContentTool } from '@/lib/ai/tools/content-runtime';
import type { ContentToolName } from '@/lib/ai/tools/content-schemas';
import { createTravelService, travelChildrenFindInputSchema, travelCityFindInputSchema, travelPlaceCreateInputSchema, travelPlaceDeleteToolInputSchema, travelPlaceFindInputSchema, travelPlaceGuideFindInputSchema, travelPlaceOpenInputSchema, travelPlaceReferenceGenerateInputSchema, travelPlaceReferenceListInputSchema, travelPlaceSearchInputSchema, travelPlaceUpdateToolInputSchema, travelTripAttachmentSetInputSchema, travelTripCreateInputSchema, travelTripDeleteInputSchema, travelTripGuideGenerateInputSchema, travelTripGuideListInputSchema, travelTripListInputSchema, travelTripSearchInputSchema, travelTripUpdateToolInputSchema } from '@/lib/travel/service';
import { createCountrySearchService } from '@/lib/travel/country-search';
import { createEmailService, emailDraftComposeInputSchema, emailDraftCreateInputSchema, emailDraftDeleteInputSchema, emailMessageGeneratedListInputSchema, emailMessageSummarizeInputSchema, emailMessageSummaryDeleteInputSchema, emailMessageTranslateInputSchema, emailMessageTranslationDeleteInputSchema, emailOverviewInputSchema, emailReplyContextCreateInputSchema, emailReplyContextDeleteInputSchema, emailReplyContextUpdateInputSchema, emailSemanticSearchInputSchema, emailSimilarFindInputSchema, emailThreadFavoriteInputSchema, emailThreadReadStateInputSchema, emailThreadTrashInputSchema, emailToneCreateInputSchema, emailToneDeleteInputSchema, emailToneUpdateInputSchema, emailTrashClearInputSchema, inboxSortInputSchema, inboxUpdateInputSchema, publicEmailCoreDraftSchema, publicEmailGeneratedDeleteResultSchema, publicEmailSummaryListResultSchema, publicEmailSummaryResultSchema, publicEmailTranslationListResultSchema, publicEmailTranslationResultSchema } from '@/lib/email-inbox/service';
import { defaultBookService } from '@/lib/books/default-service';
import { bookExtendToolInputSchema, bookFavoriteToolInputSchema, bookGoalSuggestToolInputSchema, bookShareDetailToolInputSchema, bookShareUpdateToolInputSchema, bookTopicSuggestToolInputSchema } from '@/lib/books/service';
import { emailDraftUpdateInputSchema } from '@/lib/email-inbox/service';
import type { EmailActor } from '@/lib/email-inbox/service';
import { newId } from '@/lib/ids';
import { userHiddenOperations } from '@/lib/user-hiddens/operations';
import type { AssistantCapability, AssistantCapabilityContext } from './capabilities';
import { appSearchInputSchema, createAppSearchService } from '@/lib/app-search/service';
import { appTextEnhanceInputSchema, appTextTranslateInputSchema, createAppTransformationService } from '@/lib/app-transformation/service';
import { appAudioInputSchema, createAppAudioService } from '@/lib/app-audio/service';

const key = z.string().cuid();
const name = z.string().trim().min(1).max(255);
const appEnhanceInputSchema = z.object({
  text: appTextEnhanceInputSchema.shape.text.optional(),
  documentKey: key.optional(),
  instruction: appTextEnhanceInputSchema.shape.instruction,
  save: z.boolean().default(true),
}).strict().refine(({ text, documentKey }) => !(text && documentKey), 'Choose text or a document, not both.');
const appTranslateInputSchema = z.object({
  text: appTextTranslateInputSchema.shape.text.optional(),
  documentKey: key.optional(),
  messageKey: key.optional(),
  targetLanguage: appTextTranslateInputSchema.shape.targetLanguage,
  sourceLanguage: appTextTranslateInputSchema.shape.sourceLanguage,
  instruction: appTextTranslateInputSchema.shape.instruction,
  save: z.boolean().default(true),
}).strict().refine(({ text, documentKey, messageKey }) => Number(Boolean(text)) + Number(Boolean(documentKey)) + Number(Boolean(messageKey)) <= 1, 'Choose only one source.');

function identity(context: AssistantCapabilityContext) {
  const { domain } = context;
  if (domain.principal.kind !== 'member') throw new Error('A member principal is required for personal assistant capabilities.');
  if (domain.principal.userOrganization.organizationId !== domain.organizationKey || domain.principal.userOrganization.userId !== domain.principal.user.key || domain.principal.userOrganization.status !== 'active') throw new Error('Active matching organization membership is required.');
  const serviceContext = { organizationKey: domain.organizationKey, scopeKey: domain.runtimeScopeKey };
  return {
    userKey: domain.principal.user.key,
    serviceContext,
    emailActor: { userKey: domain.principal.user.key, ...serviceContext } satisfies EmailActor,
  };
}

function withoutBcc(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutBcc);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key.toLocaleLowerCase() !== 'bcc').map(([key, item]) => [key, withoutBcc(item)]));
}

function projectSignalOutput(name: string, value: unknown) {
  const redacted = withoutBcc(value);
  return ['email.draft.create', 'email.draft.compose', 'email.draft.update', 'email.draft.assign'].includes(name)
    ? publicEmailCoreDraftSchema.parse(redacted)
    : redacted;
}

function capability<Schema extends z.ZodTypeAny>(name: string, description: string, schema: Schema, execute: (input: z.output<Schema>, context: AssistantCapabilityContext) => Promise<unknown>, mutationWorkspace?: AssistantCapability['mutationWorkspace']): AssistantCapability<Schema> {
  return {
    inputSchema: schema,
    mutationWorkspace,
    definition: { name, description, inputSchema: contentZodToJsonSchema(schema) },
    async execute(rawInput, context) {
      const result = await execute(schema.parse(rawInput), context);
      return { kind: 'continue', result: name.startsWith('email.') || name.startsWith('inbox.') ? projectSignalOutput(name, result) : result };
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

export const appSearchCapability: AssistantCapability<typeof appSearchInputSchema> = {
  inputSchema: appSearchInputSchema,
  definition: {
    name: 'app.search',
    description: 'Search selected user collections with one unified text query.',
    inputSchema: contentZodToJsonSchema(appSearchInputSchema),
  },
  async execute(rawInput, context) {
    const input = appSearchInputSchema.parse(rawInput);
    const output = await (context.appSearch ?? createAppSearchService()).search(input, context.domain, {
      signal: context.signal,
      timeoutMs: context.timeoutMs,
      contentDependencies: context.contentDependencies,
      executeContent: context.executeContent,
      email: context.email,
      travel: context.travel,
      countries: context.countries,
    });
    const sources = output.groups.flatMap((group) => group.collectionSlug === 'documents' || group.collectionSlug === 'files'
      ? group.results.map(({ key: documentKey, name }) => ({ documentKey, name }))
      : []);
    return { kind: 'continue', result: output, sources };
  },
};

export const appEnhanceCapability = capability('app.enhance', 'Improve spelling, grammar, punctuation, and wording while preserving the source meaning.', appEnhanceInputSchema, async ({ text, documentKey, instruction, save }, context) => {
  if (text) return (context.appTransformation ?? createAppTransformationService()).enhance({ text, instruction }, context.domain.organizationKey, { signal: context.signal, timeoutMs: context.timeoutMs });
  const canonicalInput = { documentKeys: [currentDocumentKey(documentKey, context)], instruction, mode: save ? 'replace' as const : 'preview' as const, ...(save ? { idempotencyKey: `${context.requestKey ?? newId()}:app.enhance` } : {}) };
  return (context.executeContent ?? runContentTool)('document.enhance', canonicalInput, context.domain, context.contentDependencies);
}, (rawInput) => {
  const input = appEnhanceInputSchema.parse(rawInput);
  return !input.text && input.save ? 'archive' : undefined;
});

export const appTranslateCapability = capability('app.translate', 'Translate text, an Archive document, or a Signal message into a requested language while preserving meaning and structure.', appTranslateInputSchema, async ({ text, documentKey, messageKey, save, ...input }, context) => {
  if (text) return (context.appTransformation ?? createAppTransformationService()).translate({ text, ...input }, context.domain.organizationKey, { signal: context.signal, timeoutMs: context.timeoutMs });
  if (messageKey) {
    const actor = identity(context);
    return publicEmailTranslationResultSchema.parse(await (context.email ?? createEmailService()).translateMessage(actor.emailActor, { messageKey, targetLanguage: input.targetLanguage, sourceLanguage: input.sourceLanguage }, context.requestKey));
  }
  const canonicalInput = { documentKeys: [currentDocumentKey(documentKey, context)], ...input, preserveFormatting: true, mode: save ? 'replace' as const : 'preview' as const, ...(save ? { idempotencyKey: `${context.requestKey ?? newId()}:app.translate` } : {}) };
  return (context.executeContent ?? runContentTool)('document.translate', canonicalInput, context.domain, context.contentDependencies);
}, (rawInput) => {
  const input = appTranslateInputSchema.parse(rawInput);
  return input.messageKey ? 'signal' : !input.text && input.save ? 'archive' : undefined;
});

export const appAudioCapability = capability('app.audio', 'Generate and persist a narrated audio version of an Archive document.', appAudioInputSchema, async (input, context) => {
  return (context.appAudio ?? createAppAudioService({ content: context.contentDependencies, executeContent: context.executeContent })).generateDocument(input, context.domain, { signal: context.signal, timeoutMs: context.timeoutMs });
}, 'archive');

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
  archive('document.list-versions', 'List saved versions of the open Archive document, or an explicitly identified document.', z.object({ documentKey: key.optional(), limit: z.number().int().min(1).max(100).optional() }).strict(), 'document.list-versions', ({ documentKey, ...input }, context) => ({ documentKeys: [currentDocumentKey(documentKey, context)], ...input })),
  archive('document.restore-version', 'Restore one saved version of the open Archive document, or an explicitly identified document, and preserve the current content as a backup version.', z.object({ documentKey: key.optional(), versionKey: key }).strict(), 'document.restore-version', ({ documentKey, versionKey }, context) => ({ restores: [{ documentKey: currentDocumentKey(documentKey, context), versionKey, createBackupVersion: true }] }), true),
  archive('document.download', 'Download an Archive document as its original file or plain text.', z.object({ documentKey: key, format: z.enum(['original', 'txt']).optional() }).strict(), 'document.download', ({ documentKey, ...input }) => ({ documentKeys: [documentKey], ...input })),
  archive('content.neighbors', 'Find semantically similar active folders, documents, and files for an Archive folder or document.', z.object({ folderKey: key.optional(), documentKey: key.optional() }).strict().refine((input) => Number(input.folderKey !== undefined) + Number(input.documentKey !== undefined) === 1, 'exactly one source key is required'), 'content.neighbors', (input) => input),
  archive('content.search-history.delete', 'Delete one entry from the current user\'s global search history.', z.object({ normalizedQuery: z.string().trim().min(1).max(12_000) }).strict(), 'content.search-history.delete', (input, context) => ({ scopeKey: context.domain.runtimeScopeKey, ...input }), true),
];

export const compassCapabilities = [
  capability('country.search', 'Find the country that best matches a country-name query.', z.object({ query: z.string().trim().min(1).max(200) }).strict(), async (input, context) => { const actor = identity(context); return (context.countries ?? createCountrySearchService()).search({ organizationKey: actor.serviceContext.organizationKey, ...input }, actor.userKey, { signal: context.signal, timeoutMs: context.timeoutMs }); }),
  capability('place.find', 'Find external country and city destination candidates without saving them.', travelPlaceFindInputSchema.omit({ organizationKey: true, scopeKey: true }), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).findPlaces({ ...actor.serviceContext, ...input }, actor.userKey, { signal: context.signal, timeoutMs: context.timeoutMs }); }),
  capability('place.search', 'Semantically search the current user\'s saved places in this Compass workspace.', travelPlaceSearchInputSchema.omit({ organizationKey: true, scopeKey: true }), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).searchPlaces({ ...actor.serviceContext, ...input }, actor.userKey, { signal: context.signal, timeoutMs: context.timeoutMs }); }),
  capability('place.list', 'List saved and recently opened places.', z.object({}).strict(), async (_input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).overview(actor.serviceContext, actor.userKey); }),
  capability('place.reference.generate', 'Generate and persist one stable general-knowledge reference for a saved place.', travelPlaceReferenceGenerateInputSchema.omit({ organizationKey: true, scopeKey: true, idempotencyKey: true }), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).generatePlaceReference({ ...actor.serviceContext, ...input, idempotencyKey: `${context.requestKey ?? newId()}:place.reference.generate` }, actor.userKey, { signal: context.signal, timeoutMs: context.timeoutMs }); }, 'compass'),
  capability('place.reference.list', 'List persisted references of one kind newest first for a saved place.', travelPlaceReferenceListInputSchema.omit({ organizationKey: true, scopeKey: true }), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).listPlaceReferences({ ...actor.serviceContext, ...input }, actor.userKey); }),
  capability('trip.list', 'List trips and their ordered saved places.', travelTripListInputSchema.omit({ organizationKey: true, scopeKey: true }), async (_input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).listTrips(actor.serviceContext, actor.userKey); }),
  capability('trip.search', 'Semantically search the current user\'s trips and return their complete aggregates.', travelTripSearchInputSchema.omit({ organizationKey: true, scopeKey: true }), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).searchTrips({ ...actor.serviceContext, ...input }, actor.userKey, { signal: context.signal, timeoutMs: context.timeoutMs }); }),
  capability('trip.guide.generate', 'Generate and persist a formatted guide for one trip and its ordered places.', travelTripGuideGenerateInputSchema.omit({ organizationKey: true, scopeKey: true, idempotencyKey: true }), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).generateTripGuide({ ...actor.serviceContext, ...input, idempotencyKey: `${context.requestKey ?? newId()}:trip.guide.generate` }, actor.userKey, { signal: context.signal, timeoutMs: context.timeoutMs }); }, 'compass'),
  capability('trip.guide.list', 'List complete persisted trip guides newest first for one trip.', travelTripGuideListInputSchema.omit({ organizationKey: true, scopeKey: true }), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).listTripGuides({ ...actor.serviceContext, ...input }, actor.userKey); }),
  capability('trip.create', 'Create a trip from ordered saved places in the current Compass workspace.', travelTripCreateInputSchema.omit({ organizationKey: true, scopeKey: true, idempotencyKey: true }), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).createTrip({ ...actor.serviceContext, ...input, idempotencyKey: `${context.requestKey ?? newId()}:trip.create` }, actor.userKey); }, 'compass'),
  capability('trip.update', 'Update trip details, status, favorite state, cover, or ordered saved places.', travelTripUpdateToolInputSchema, async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).updateTrip({ ...actor.serviceContext, ...input }, actor.userKey); }, 'compass'),
  capability('trip.delete', 'Delete a non-favorite trip and its relations.', travelTripDeleteInputSchema.omit({ organizationKey: true, scopeKey: true }), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).deleteTrip({ ...actor.serviceContext, ...input }, actor.userKey); }, 'compass'),
  capability('trip.attachment.set', 'Replace all ordered Archive and Gallery references attached to a trip.', travelTripAttachmentSetInputSchema.omit({ organizationKey: true, scopeKey: true }), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).setTripAttachments({ ...actor.serviceContext, ...input }, actor.userKey); }, 'compass'),
  capability('place.guide.find', 'Find a destination and create its structured travel guide.', travelPlaceGuideFindInputSchema.omit({ organizationKey: true, scopeKey: true }), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).findPlaceGuide({ ...actor.serviceContext, ...input }, actor.userKey, { signal: context.signal, timeoutMs: context.timeoutMs }); }, 'compass'),
  capability('place.find-city', 'Find a city in an authoritative country and create its structured travel guide.', travelCityFindInputSchema.omit({ organizationKey: true, scopeKey: true }), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).findCity({ ...actor.serviceContext, ...input }, actor.userKey, { signal: context.signal, timeoutMs: context.timeoutMs }); }, 'compass'),
  capability('place.find-children', 'Find detailed guides for the ten cities sealed by a country place result.', travelChildrenFindInputSchema.omit({ organizationKey: true, scopeKey: true }), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).findChildren({ ...actor.serviceContext, ...input }, actor.userKey, { signal: context.signal, timeoutMs: context.timeoutMs }); }, 'compass'),
  capability('place.create', 'Save a country or city to the current Compass workspace.', travelPlaceCreateInputSchema.omit({ organizationKey: true, scopeKey: true }), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).createPlace({ ...actor.serviceContext, ...input }, actor.userKey, { signal: context.signal, timeoutMs: context.timeoutMs }); }, 'compass'),
  capability('place.update', 'Update the status or favorite state of a saved place.', travelPlaceUpdateToolInputSchema, async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).updatePlace({ ...actor.serviceContext, ...input }, actor.userKey); }, 'compass'),
  capability('place.delete', 'Delete one saved place and remove it from trips and reports.', travelPlaceDeleteToolInputSchema, async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).deletePlace({ ...actor.serviceContext, ...input }, actor.userKey); }, 'compass'),
  capability('place.open', 'Record that the current user opened an existing country or place.', travelPlaceOpenInputSchema.omit({ organizationKey: true, scopeKey: true }), async (input, context) => { const actor = identity(context); return (context.travel ?? createTravelService()).openPlace({ ...actor.serviceContext, ...input }, actor.userKey); }, 'compass'),
];

export const signalCapabilities = [
  capability('email.overview', 'List connected email accounts, or query one selected account by read state and enabled facets with stable cursor pagination.', emailOverviewInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).overview(actor.emailActor, input); }),
  capability('inbox.search', 'Semantically search connected Signal inboxes by their names and descriptions.', emailSemanticSearchInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).searchInboxes(actor.emailActor, input, { signal: context.signal, timeoutMs: context.timeoutMs }); }),
  capability('email.tone.search', 'Semantically search available Signal email tones by name.', emailSemanticSearchInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).searchTones(actor.emailActor, input, { signal: context.signal, timeoutMs: context.timeoutMs }); }),
  capability('inbox.sort', 'Sort every persisted email in one connected inbox into Urgent, Important, or Filtered and refresh its Archive representation.', inboxSortInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).sort(actor.emailActor, input); }, 'signal'),
  capability('inbox.update', 'Update one connected inbox name, description, cover, or favorite state.', inboxUpdateInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).updateInbox(actor.emailActor, input, context.requestKey); }, 'signal'),
  capability('email.thread.read', 'Read up to 50 Signal email messages without changing unread state. Message bodies are limited to 8,000 characters each and 64,000 characters total; truncation and a continuation cursor are returned explicitly.', z.object({ threadKey: key, cursor: z.string().min(1).max(2_000).optional() }).strict(), async ({ threadKey, cursor }, context) => { const actor = identity(context); return (context.email ?? createEmailService()).threadForTool(actor.emailActor, threadKey, cursor); }),
  capability('email.thread.read-state', 'Set read or unread state for one or up to 50 distinct Signal email threads.', emailThreadReadStateInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).setReadState(actor.emailActor, input, false, context.requestKey); }, 'signal'),
  capability('email.thread.favorite', 'Set or clear favorite state for one or up to 50 distinct Signal email threads.', emailThreadFavoriteInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).setFavorite(actor.emailActor, input, false, context.requestKey); }, 'signal'),
  capability('email.thread.trash', 'Move one email thread to the connected provider Trash while preserving its persisted classification.', emailThreadTrashInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).trashThread(actor.emailActor, input, false, context.requestKey); }, 'signal'),
  capability('email.trash.clear', 'Permanently delete every message in one connected email account Trash.', emailTrashClearInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).clearTrash(actor.emailActor, input, false, undefined, context.requestKey); }, 'signal'),
  capability('email.similar.find', 'Find semantically similar messages outside the selected message thread, with at most one result per thread.', emailSimilarFindInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).findSimilar(actor.emailActor, input); }),
  capability('email.message.translation.list', 'List immutable translations saved for one selected persisted email message.', emailMessageGeneratedListInputSchema, async (input, context) => { const actor = identity(context); return publicEmailTranslationListResultSchema.parse(await (context.email ?? createEmailService()).listMessageTranslations(actor.emailActor, input)); }),
  capability('email.message.translation.delete', 'Atomically delete one or more translations belonging to one selected persisted email message.', emailMessageTranslationDeleteInputSchema, async (input, context) => { const actor = identity(context); return publicEmailGeneratedDeleteResultSchema.parse(await (context.email ?? createEmailService()).deleteMessageTranslations(actor.emailActor, input, context.requestKey)); }, 'signal'),
  capability('email.message.summarize', 'Summarize one selected persisted email message and save an immutable summary.', emailMessageSummarizeInputSchema, async (input, context) => { const actor = identity(context); return publicEmailSummaryResultSchema.parse(await (context.email ?? createEmailService()).summarizeMessage(actor.emailActor, input, context.requestKey)); }, 'signal'),
  capability('email.message.summary.list', 'List immutable summaries saved for one selected persisted email message.', emailMessageGeneratedListInputSchema, async (input, context) => { const actor = identity(context); return publicEmailSummaryListResultSchema.parse(await (context.email ?? createEmailService()).listMessageSummaries(actor.emailActor, input)); }),
  capability('email.message.summary.delete', 'Atomically delete one or more summaries belonging to one selected persisted email message.', emailMessageSummaryDeleteInputSchema, async (input, context) => { const actor = identity(context); return publicEmailGeneratedDeleteResultSchema.parse(await (context.email ?? createEmailService()).deleteMessageSummaries(actor.emailActor, input, context.requestKey)); }, 'signal'),
  capability('email.draft.create', 'Generate a reply or reply-all draft for a Signal email thread without sending it.', emailDraftCreateInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).draft(actor.emailActor, input, context.requestKey); }, 'signal'),
  capability('email.draft.compose', 'Generate or preserve and save a new email draft in a selected inbox.', emailDraftComposeInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).draftNew(actor.emailActor, input, context.requestKey); }, 'signal'),
  capability('email.tone.list', 'List the protected email drafting tones available in this workspace.', z.object({}).strict(), async (_input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).tones(actor.emailActor); }),
  capability('email.tone.create', 'Create a custom email drafting tone.', emailToneCreateInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).createTone(actor.emailActor, input, context.requestKey); }, 'signal'),
  capability('email.tone.update', 'Update an email drafting tone.', emailToneUpdateInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).updateTone(actor.emailActor, input, context.requestKey); }, 'signal'),
  capability('email.tone.delete', 'Hard-delete one custom email drafting tone and its generated dependents.', emailToneDeleteInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).deleteTone(actor.emailActor, input, context.requestKey); }, 'signal'),
  capability('email.reply-context.list', 'List all protected facts and preferences automatically used when drafting email replies.', z.object({}).strict(), async (_input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).listReplyContext(actor.emailActor); }),
  capability('email.reply-context.create', 'Create one protected fact or preference used automatically in email replies.', emailReplyContextCreateInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).createReplyContext(actor.emailActor, input, context.requestKey); }, 'signal'),
  capability('email.reply-context.update', 'Update one protected email reply-context note.', emailReplyContextUpdateInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).updateReplyContext(actor.emailActor, input, context.requestKey); }, 'signal'),
  capability('email.reply-context.delete', 'Atomically hard-delete one or more protected email reply-context notes.', emailReplyContextDeleteInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).deleteReplyContext(actor.emailActor, input, context.requestKey); }, 'signal'),
  capability('email.draft.update', 'Update the final content and/or canonical attachments of a Signal email draft without sending it.', emailDraftUpdateInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).updateDraft(actor.emailActor, input, context.requestKey); }, 'signal'),
  capability('email.draft.assign', 'Assign a legacy unassigned new email draft to one connected inbox.', z.object({ draftKey: key, connectorKey: key }).strict(), async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).assignDraft(actor.emailActor, input, context.requestKey); }, 'signal'),
  capability('email.draft.send', 'Send a reviewed Signal email draft. connectorKey is only needed for a legacy unassigned new draft. replyMode may override recipients for a reply draft.', z.object({ draftKey: key, connectorKey: key.optional(), replyMode: z.enum(['reply', 'reply_all']).optional() }).strict(), async ({ draftKey, connectorKey, replyMode }, context) => { const actor = identity(context); return (context.email ?? createEmailService()).sendDraft(actor.emailActor, draftKey, connectorKey, context.requestKey, replyMode); }, 'signal'),
  capability('email.draft.delete', 'Hard-delete one unsent, inactive email draft and its generated dependents.', emailDraftDeleteInputSchema, async (input, context) => { const actor = identity(context); return (context.email ?? createEmailService()).deleteDraft(actor.emailActor, input, context.requestKey); }, 'signal'),
];

export const ascendCapabilities = [
  capability('book.list', 'List Ascend books and reading progress.', z.object({}).strict(), async (_input, context) => { const actor = identity(context); return (context.books ?? defaultBookService).overview(actor.serviceContext, actor.userKey); }),
  capability('book.topic.suggest', 'Suggest ten distinct, creative audiobook topics.', bookTopicSuggestToolInputSchema, async (input, context) => { const actor = identity(context); return (context.books ?? defaultBookService).suggestTopics({ ...actor.serviceContext, ...input }, actor.userKey, { signal: context.signal, timeoutMs: context.timeoutMs }); }),
  capability('book.goal.suggest', 'Suggest ten distinct reader goals for an audiobook topic.', bookGoalSuggestToolInputSchema, async (input, context) => { const actor = identity(context); return (context.books ?? defaultBookService).suggestGoals({ ...actor.serviceContext, ...input }, actor.userKey, { signal: context.signal, timeoutMs: context.timeoutMs }); }),
  capability('book.detail', 'Read an Ascend book, chapters, and progress.', z.object({ bookKey: key }).strict(), async ({ bookKey }, context) => { const actor = identity(context); return (context.books ?? defaultBookService).detail(bookKey, actor.serviceContext, actor.userKey); }),
  capability('book.extend', 'Preview unique continuation chapter titles or accept selected titles for durable background generation.', bookExtendToolInputSchema, async ({ bookKey, ...input }, context) => {
    const actor = identity(context);
    const rawRequestKey = ('clientRequestKey' in context ? context.clientRequestKey : context.requestKey)?.trim();
    const requestKey = !rawRequestKey ? newId() : rawRequestKey.length <= 200 ? rawRequestKey : createHash('sha256').update(rawRequestKey).digest('hex');
    return (context.books ?? defaultBookService).extend(bookKey, { ...actor.serviceContext, ...input, ...(input.mode === 'generate' ? { requestKey } : {}) }, actor.userKey, { signal: context.signal, timeoutMs: context.timeoutMs });
  }, (input) => (input as { mode?: unknown }).mode === 'generate' ? 'ascend' : undefined),
  capability('book.share.detail', 'Read whether an audiobook share link is active. The private URL is not exposed to the model.', bookShareDetailToolInputSchema, async ({ bookKey }, context) => { const actor = identity(context); const { url: _url, ...safe } = await (context.books ?? defaultBookService).shareDetail(bookKey, actor.serviceContext, actor.userKey); return safe; }),
  capability('book.share.update', 'Activate or deactivate an audiobook share link. The private URL is not exposed to the model.', bookShareUpdateToolInputSchema, async ({ bookKey, active }, context) => { const actor = identity(context); const { url: _url, ...safe } = await (context.books ?? defaultBookService).setShareActive(bookKey, { ...actor.serviceContext, active }, actor.userKey); return safe; }, 'ascend'),
  capability('book.chapter.progress', 'Update progress for an Ascend chapter.', z.object({ bookKey: key, chapterKey: key, progressSeconds: z.number().int().nonnegative(), isCompleted: z.boolean() }).strict(), async ({ bookKey, chapterKey, ...input }, context) => { const actor = identity(context); return (context.books ?? defaultBookService).progress(bookKey, chapterKey, { ...actor.serviceContext, ...input }, actor.userKey); }, 'ascend'),
  capability('book.create', 'Accept a personalized audiobook for durable background generation.', z.object({ topic: z.string().trim().min(3).max(500), goal: z.string().trim().min(3).max(1_000), currentKnowledge: z.string().trim().min(2).max(2_000), writingTone: z.string().trim().min(2).max(200), chapterCount: z.union([z.literal(10), z.literal(25), z.literal(50)]), language: z.string().trim().min(2).max(100), archiveDocumentKeys: z.array(key).max(50), narratorVoiceKey: z.enum(['calm', 'clear', 'warm']), narrationPace: z.number().min(0.75).max(2), chapterImages: z.boolean(), additionalInstructions: z.string().trim().max(12_000).optional() }).strict(), async (input, context) => {
    const actor = identity(context);
    const requestKey = ('clientRequestKey' in context ? context.clientRequestKey : context.requestKey)?.trim();
    const generationRequestKey = !requestKey ? newId() : requestKey.length <= 200 ? requestKey : createHash('sha256').update(requestKey).digest('hex');
    return (context.books ?? defaultBookService).create({ ...actor.serviceContext, generationRequestKey, ...input }, actor.userKey);
  }, 'ascend'),
  capability('book.generation.retry', 'Retry failed or cancelled audiobook generation.', z.object({ bookKey: key }).strict(), async ({ bookKey }, context) => { const actor = identity(context); return (context.books ?? defaultBookService).retry(bookKey, actor.serviceContext, actor.userKey); }, 'ascend'),
  capability('book.generation.cancel', 'Cancel audiobook generation.', z.object({ bookKey: key }).strict(), async ({ bookKey }, context) => { const actor = identity(context); return (context.books ?? defaultBookService).cancel(bookKey, actor.serviceContext, actor.userKey); }, 'ascend'),
  capability('book.favorite', 'Set or clear favorite state for an audiobook.', bookFavoriteToolInputSchema, async ({ bookKey, isFavorite }, context) => { const actor = identity(context); return (context.books ?? defaultBookService).setFavorite(bookKey, { ...actor.serviceContext, isFavorite }, actor.userKey); }, 'ascend'),
  capability('book.delete', 'Hard-delete a non-favorite audiobook and generated Archive and storage dependents.', z.object({ bookKey: key }).strict(), async ({ bookKey }, context) => { const actor = identity(context); return (context.books ?? defaultBookService).delete(bookKey, actor.serviceContext, actor.userKey); }, 'ascend'),
];
