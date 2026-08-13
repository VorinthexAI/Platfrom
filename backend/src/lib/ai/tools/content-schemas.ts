import { z } from 'zod';
import { documentParseInputSchema } from '@/lib/ai/document-processing/schemas';
import { documentExtensionSchema } from '@/lib/ai/document-processing/schemas';
import { contentErrorSchema } from './content-errors';

const keySchema = z.string().cuid();
const keysSchema = z.array(keySchema).min(1).max(100);
const nameSchema = z.string().trim().min(1).max(255);
const textSchema = z.string().trim().min(1);
const cursorSchema = z.string().trim().min(1);
const limitSchema = z.number().int().min(1).max(100);
const atomicSchema = z.boolean().default(false);
const idempotencyShape = { idempotencyKey: z.string().trim().min(1).max(200).optional() } as const;
const dateTimeSchema = z.string().datetime();
const folderSortSchema = z.object({ field: z.enum(['name', 'createdAt', 'updatedAt']), direction: z.enum(['asc', 'desc']) }).strict();
const documentSortSchema = z.object({ field: z.enum(['name', 'createdAt', 'updatedAt']), direction: z.enum(['asc', 'desc']) }).strict();

export const contentFolderSchema = z.object({
  key: keySchema,
  scopeKey: keySchema,
  parentFolderKey: keySchema.optional(),
  name: nameSchema,
  description: textSchema.optional(),
  coverUrl: z.string().url().optional(),
  deletedAt: dateTimeSchema.nullable().default(null),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  childrenCount: z.number().int().nonnegative().optional(),
  documentCount: z.number().int().nonnegative().optional(),
}).strict();

export const contentDocumentShareSchema = z.object({
  key: keySchema,
  scopeKey: keySchema,
  documentKey: keySchema,
  permission: z.enum(['read', 'comment']),
  expiresAt: dateTimeSchema.optional(),
  revokedAt: dateTimeSchema.optional(),
  deletedAt: dateTimeSchema.nullable().default(null),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
}).strict();

export const contentDocumentVersionSchema = z.object({
  key: keySchema,
  scopeKey: keySchema,
  documentKey: keySchema,
  version: z.number().int().positive(),
  label: z.string().trim().min(1).max(120).optional(),
  deletedAt: dateTimeSchema.nullable().default(null),
  createdAt: dateTimeSchema,
}).strict();

export const contentProjectedDocumentVersionSchema = contentDocumentVersionSchema.extend({
  html: z.string().optional(),
  content: z.string().optional(),
  embedding: z.array(z.number().finite()).min(1).optional(),
}).strict();

export const contentDocumentSchema = z.object({
  key: keySchema,
  scopeKey: keySchema,
  folderKey: keySchema.optional(),
  name: nameSchema,
  extension: documentExtensionSchema.optional(),
  mimeType: textSchema.optional(),
  sizeBytes: z.number().int().positive().optional(),
  isFavorite: z.boolean().default(false),
  deletedAt: dateTimeSchema.nullable().default(null),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
}).strict();

export const contentProjectedDocumentSchema = contentDocumentSchema.extend({
  html: z.string().optional(),
  content: z.string().optional(),
  embedding: z.array(z.number().finite()).min(1).optional(),
  folder: contentFolderSchema.optional(),
  shares: z.array(contentDocumentShareSchema).optional(),
  latestVersion: contentDocumentVersionSchema.optional(),
}).strict();

export const contentBatchSummarySchema = z.object({
  requested: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
}).strict().refine((value) => value.succeeded + value.failed === value.requested, 'succeeded and failed must equal requested');

export function contentBatchResultSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    key: keySchema,
    success: z.boolean(),
    data: dataSchema.optional(),
    error: contentErrorSchema.optional(),
  }).strict().superRefine((value, context) => {
    if (value.success && value.error) context.addIssue({ code: z.ZodIssueCode.custom, message: 'successful results cannot contain an error' });
    if (!value.success && !value.error) context.addIssue({ code: z.ZodIssueCode.custom, message: 'failed results require an error' });
    if (!value.success && value.data !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: 'failed results cannot contain data' });
  });
}

export function contentBatchOutputSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({ results: z.array(contentBatchResultSchema(dataSchema)), summary: contentBatchSummarySchema }).strict().superRefine((value, context) => {
    if (value.results.length !== value.summary.requested) context.addIssue({ code: z.ZodIssueCode.custom, message: 'results must contain one item per requested resource' });
    if (value.results.filter((result) => result.success).length !== value.summary.succeeded) context.addIssue({ code: z.ZodIssueCode.custom, message: 'result statuses must match summary counts' });
  });
}

const emptyDataSchema = z.object({}).strict();
const folderDataSchema = z.object({ folder: contentFolderSchema }).strict();
const documentDataSchema = z.object({ document: contentDocumentSchema }).strict();
const projectedDocumentDataSchema = z.object({ document: contentProjectedDocumentSchema }).strict();
const shareDataSchema = z.object({ share: contentDocumentShareSchema }).strict();
const unsharedDataSchema = z.union([
  shareDataSchema,
  z.object({ documentKey: keySchema, shares: z.array(contentDocumentShareSchema) }).strict(),
]);
const createdShareDataSchema = z.object({
  share: contentDocumentShareSchema,
  token: z.string().min(32),
}).strict();
const copiedDocumentDataSchema = z.object({
  document: contentDocumentSchema,
  shares: z.array(createdShareDataSchema).optional(),
}).strict();
const versionDataSchema = z.object({ version: contentDocumentVersionSchema }).strict();
const projectedVersionDataSchema = z.object({ version: contentProjectedDocumentVersionSchema }).strict();
const fileDataSchema = z.object({ documentKey: keySchema, format: z.string().trim().min(1), fileName: nameSchema, mimeType: textSchema, encoding: z.literal('base64'), content: z.string() }).strict();
const generatedTextDataSchema = z.object({ documentKey: keySchema, text: z.string(), language: z.string().trim().min(1).optional(), persistedDocumentKey: keySchema.optional() }).strict();
const autocompleteDataSchema = z.object({ completion: z.string().trim().min(1) }).strict();
const enhancedContentDataSchema = z.object({ content: z.string().trim().min(1) }).strict();
const canonicalRepresentationSchema = z.object({
  html: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
  if (Number(value.html !== undefined) + Number(value.content !== undefined) !== 1) context.addIssue({ code: z.ZodIssueCode.custom, message: 'exactly one of html or content is required' });
});
const bookBriefShape = {
  scopeKey: keySchema,
  topic: z.string().trim().min(1).max(500),
  goal: z.string().trim().min(1).max(1_000),
  audience: z.string().trim().min(1).max(500),
  tone: z.string().trim().min(1).max(200),
  length: z.enum(['short', 'standard', 'deep']),
  language: z.string().trim().min(1).max(100),
  sourceNotes: z.string().trim().min(1).max(40_000).optional(),
} as const;
const bookToolDataSchema = z.object({ bookKey: keySchema, status: z.enum(['planning', 'researching', 'generating', 'ready', 'failed']) }).strict();

const folderUpdateSchema = z.object({ folderKey: keySchema, name: nameSchema.optional(), description: textSchema.nullable().optional(), coverImageKey: keySchema.nullable().optional() }).strict()
  .refine((value) => value.name !== undefined || value.description !== undefined || value.coverImageKey !== undefined, 'folder metadata is required');
const documentUpdateSchema = z.object({
  documentKey: keySchema,
  html: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  isFavorite: z.boolean().optional(),
  createVersion: z.boolean().optional(),
  expectedUpdatedAt: dateTimeSchema.optional(),
}).strict().superRefine((value, context) => {
  const representations = [value.html, value.content].filter((item) => item !== undefined).length;
  if (representations === 0 && value.isFavorite === undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: 'a document representation or isFavorite is required' });
  if (representations > 1) context.addIssue({ code: z.ZodIssueCode.custom, message: 'html and content are mutually exclusive' });
  if (value.createVersion && representations === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['createVersion'], message: 'createVersion requires a document representation' });
});

export const contentSearchSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scope'), scopeKeys: keysSchema }).strict(),
  z.object({ type: z.literal('project'), projectKeys: keysSchema }).strict(),
  z.object({ type: z.literal('folder'), folderKeys: keysSchema, includeDescendants: z.boolean().optional() }).strict(),
]);

const commonSearchFilterShape = {
  extensions: z.array(documentExtensionSchema).min(1).optional(),
  createdAfter: dateTimeSchema.optional(),
  createdBefore: dateTimeSchema.optional(),
  updatedAfter: dateTimeSchema.optional(),
  updatedBefore: dateTimeSchema.optional(),
  includeArchived: z.boolean().optional(),
  documentKeys: keysSchema.optional(),
};
export const contentSearchFiltersSchema = z.object(commonSearchFilterShape).strict();
export const organizationContentSearchFiltersSchema = z.object({
  ...commonSearchFilterShape,
  scopeKeys: keysSchema.optional(),
  projectKeys: keysSchema.optional(),
  folderKeys: keysSchema.optional(),
}).strict();
const searchIncludeSchema = z.array(z.enum(['snippet', 'content', 'html', 'folder', 'scoreBreakdown'])).min(1);
const organizationSearchIncludeSchema = z.array(z.enum(['snippet', 'content', 'html', 'folder', 'scoreBreakdown', 'scope'])).min(1);
const searchInputShape = {
  query: textSchema.max(8_000),
  sources: z.array(contentSearchSourceSchema).min(1).optional(),
  filters: contentSearchFiltersSchema.optional(),
  topK: z.number().int().min(1).max(100).optional(),
  minimumScore: z.number().min(0).max(1).optional(),
  include: searchIncludeSchema.optional(),
};

const normalizedScoreSchema = z.number().min(0).max(1);
const searchScoreBreakdownSchema = z.object({ vector: normalizedScoreSchema.optional(), lexical: normalizedScoreSchema.optional(), recency: normalizedScoreSchema.optional(), final: normalizedScoreSchema }).strict();
export const contentSearchResultSchema = z.object({
  documentKey: keySchema,
  name: nameSchema,
  scopeKey: keySchema,
  folderKey: keySchema.optional(),
  score: normalizedScoreSchema,
  snippet: z.string().optional(),
  content: z.string().optional(),
  html: z.string().optional(),
  folder: contentFolderSchema.optional(),
  scope: z.object({ key: keySchema }).strict().optional(),
  matchedSource: z.object({ type: z.enum(['scope', 'project', 'folder']), key: keySchema }).strict().optional(),
  scoreBreakdown: searchScoreBreakdownSchema.optional(),
}).strict();
export const contentSearchOutputSchema = z.object({ query: textSchema, results: z.array(contentSearchResultSchema), totalCandidates: z.number().int().nonnegative().optional() }).strict();
const workspaceFolderMatchSchema = z.object({ key: keySchema, scopeKey: keySchema, parentFolderKey: keySchema.optional(), name: nameSchema, description: z.string().optional(), score: normalizedScoreSchema }).strict();
const workspaceDocumentMatchSchema = z.object({ documentKey: keySchema, scopeKey: keySchema, folderKey: keySchema.optional(), name: nameSchema, score: normalizedScoreSchema, summary: z.string().trim().min(1) }).strict();
export const scopeContentSearchOutputSchema = z.object({ query: textSchema, folders: z.array(workspaceFolderMatchSchema).max(4), documents: z.array(workspaceDocumentMatchSchema).max(10), cached: z.boolean() }).strict();
export const contentSearchHistoryItemSchema = z.object({ query: textSchema, normalizedQuery: textSchema, searchedAt: dateTimeSchema, count: z.number().int().positive(), folderKey: keySchema.optional(), includeDescendants: z.boolean().optional(), documents: z.array(workspaceDocumentMatchSchema).max(10) }).strict();

const documentReadDataSchema = z.union([
  z.object({ documentKey: keySchema, title: nameSchema, content: z.string() }).strict(),
  z.object({ documentKey: keySchema, title: nameSchema, html: z.string() }).strict(),
  z.object({
    documentKey: keySchema,
    title: nameSchema,
    audio: z.array(z.object({ index: z.number().int().nonnegative(), storageKey: textSchema.optional(), url: z.string().url().optional(), durationMs: z.number().int().nonnegative().optional(), startCharacter: z.number().int().nonnegative(), endCharacter: z.number().int().nonnegative() }).strict()),
    totalDurationMs: z.number().int().nonnegative().optional(),
  }).strict(),
]);

export const contentToolContracts = {
  autocomplete: { description: 'Complete the text immediately following a writing context.', input: z.object({ context: z.string().trim().min(1).max(12_000), wordCount: z.number().int().min(1).max(24) }).strict(), output: autocompleteDataSchema },
  enhance: { description: 'Correct spelling, grammar, wording, and clarity while preserving meaning and formatting.', input: z.object({ content: z.string().trim().min(1).max(40_000) }).strict(), output: enhancedContentDataSchema },
  'book.create-context': { description: 'Create a resumable book and its generation context from a broad reader brief.', input: z.object({ ...bookBriefShape, ...idempotencyShape }).strict(), output: bookToolDataSchema },
  'book.write': { description: 'Generate or resume an outlined book, chapter prose, speech, and cover.', input: z.object({ bookKey: keySchema, ...bookBriefShape, ...idempotencyShape }).strict(), output: bookToolDataSchema },
  'folder.create': { description: 'Create one or more Content folders.', input: z.object({ folders: z.array(z.object({ key: keySchema.optional(), scopeKey: keySchema, parentFolderKey: keySchema.optional(), name: nameSchema, description: textSchema.optional(), coverImageKey: keySchema.optional() }).strict()).min(1).max(100), ...idempotencyShape }).strict(), output: contentBatchOutputSchema(folderDataSchema) },
  'folder.find': { description: 'Find Content folders by key.', input: z.object({ folderKeys: keysSchema, includeArchived: z.boolean().optional(), includeChildrenCount: z.boolean().optional(), includeDocumentCount: z.boolean().optional() }).strict(), output: contentBatchOutputSchema(folderDataSchema) },
  'folder.list': { description: 'List folders under a scope or parent folder.', input: z.object({ scopeKey: keySchema, parentFolderKey: keySchema.optional(), includeArchived: z.boolean().optional(), includeDocuments: z.boolean().optional(), cursor: cursorSchema.optional(), limit: limitSchema.optional(), sort: folderSortSchema.optional() }).strict(), output: z.object({ folders: z.array(contentFolderSchema), documents: z.array(contentDocumentSchema).optional(), cursor: cursorSchema.optional() }).strict() },
  'folder.update': { description: 'Update folder metadata.', input: z.object({ updates: z.array(folderUpdateSchema).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(folderDataSchema) },
  'folder.rename': { description: 'Rename folders.', input: z.object({ renames: z.array(z.object({ folderKey: keySchema, name: nameSchema }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(folderDataSchema) },
  'folder.move': { description: 'Move folders to another parent or the scope root.', input: z.object({ moves: z.array(z.object({ folderKey: keySchema, targetParentFolderKey: keySchema.optional() }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(folderDataSchema) },
  'folder.archive': { description: 'Content folders.', input: z.object({ folderKeys: keysSchema, includeDescendants: z.boolean().optional(), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(folderDataSchema) },
  'folder.restore': { description: 'Restore archived folders.', input: z.object({ folderKeys: keysSchema, includeDescendants: z.boolean().optional(), restoreAncestors: z.boolean().optional(), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(folderDataSchema) },
  'folder.delete': { description: 'Permanently delete folders.', input: z.object({ folderKeys: keysSchema, recursive: z.boolean().optional(), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(emptyDataSchema) },
  'document.parse': { description: 'Parse a TXT, Markdown, DOC, DOCX, or PDF file into canonical HTML, derived plain text, and an embedding.', input: documentParseInputSchema.extend(idempotencyShape), output: z.object({ document: contentDocumentSchema }).strict() },
  'document.create': { description: 'Create a live document from exactly one canonical representation without creating a version.', input: z.object({ scopeKey: keySchema, folderKey: keySchema.optional(), name: nameSchema, representation: canonicalRepresentationSchema, ...idempotencyShape }).strict(), output: z.object({ document: contentDocumentSchema }).strict() },
  'document.find': { description: 'Find documents by key.', input: z.object({ documentKeys: keysSchema, includeArchived: z.boolean().optional(), include: z.array(z.enum(['html', 'content', 'embedding', 'folder', 'shares', 'latestVersion'])).min(1).optional() }).strict(), output: contentBatchOutputSchema(projectedDocumentDataSchema) },
  'document.list': { description: 'List documents at a scope location; omit folderKey for the Content root.', input: z.object({ scopeKey: keySchema, folderKey: keySchema.optional(), includeArchived: z.boolean().optional(), cursor: cursorSchema.optional(), limit: limitSchema.optional(), sort: documentSortSchema.optional(), extensions: z.array(documentExtensionSchema).min(1).optional() }).strict(), output: z.object({ documents: z.array(contentDocumentSchema), cursor: cursorSchema.optional() }).strict() },
  'document.read': { description: 'Read document content or generate chunked audio.', input: z.object({ documentKeys: keysSchema, mode: z.enum(['content', 'html', 'audio']).default('content'), language: textSchema.optional(), voice: textSchema.optional(), speakingRate: z.number().min(0.25).max(4).optional(), startOffset: z.number().int().nonnegative().optional(), endOffset: z.number().int().positive().optional(), includeTitle: z.boolean().optional(), includeCode: z.boolean().optional(), persistAudio: z.boolean().optional(), atomic: atomicSchema, ...idempotencyShape }).strict().superRefine((value, context) => {
    if (value.endOffset !== undefined && value.startOffset !== undefined && value.endOffset <= value.startOffset) context.addIssue({ code: z.ZodIssueCode.custom, message: 'endOffset must be greater than startOffset' });
    if (value.mode !== 'audio') {
      for (const field of ['language', 'voice', 'speakingRate', 'startOffset', 'endOffset', 'includeTitle', 'includeCode', 'persistAudio'] as const) {
        if (value[field] !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is only valid in audio mode` });
      }
    }
  }), output: contentBatchOutputSchema(documentReadDataSchema) },
  'document.update': { description: 'Update document content.', input: z.object({ updates: z.array(documentUpdateSchema).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(documentDataSchema) },
  'document.rename': { description: 'Rename documents.', input: z.object({ renames: z.array(z.object({ documentKey: keySchema, name: nameSchema }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(documentDataSchema) },
  'document.move': { description: 'Move documents to a scoped folder or the Content root.', input: z.object({ moves: z.array(z.object({ documentKey: keySchema, targetScopeKey: keySchema, targetFolderKey: keySchema.optional() }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(documentDataSchema) },
  'document.copy': { description: 'Copy documents to a scoped folder or the Content root.', input: z.object({ copies: z.array(z.object({ documentKey: keySchema, targetScopeKey: keySchema, targetFolderKey: keySchema.optional(), newName: nameSchema.optional(), includeVersions: z.boolean().default(false), includeShares: z.boolean().default(false) }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(copiedDocumentDataSchema) },
  'document.archive': { description: 'Content documents.', input: z.object({ documentKeys: keysSchema, atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(documentDataSchema) },
  'document.restore': { description: 'Restore archived documents.', input: z.object({ documentKeys: keysSchema, restoreAncestors: z.boolean().optional(), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(documentDataSchema) },
  'document.delete': { description: 'Permanently delete documents and optionally their versions and shares.', input: z.object({ documentKeys: keysSchema, deleteVersions: z.boolean().optional(), deleteShares: z.boolean().optional(), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(emptyDataSchema) },
  'document.download': { description: 'Download documents.', input: z.object({ documentKeys: keysSchema, format: z.enum(['original', 'html', 'txt', 'md']).default('original') }).strict(), output: contentBatchOutputSchema(fileDataSchema) },
  'document.export': { description: 'Export documents to selected formats.', input: z.object({ exports: z.array(z.object({ documentKey: keySchema, format: z.enum(['html', 'txt', 'md', 'pdf', 'docx']) }).strict()).min(1).max(100), atomic: atomicSchema }).strict(), output: contentBatchOutputSchema(fileDataSchema) },
  'document.share': { description: 'Create document shares.', input: z.object({ shares: z.array(z.object({ documentKey: keySchema, permission: z.enum(['read', 'comment']), expiresAt: dateTimeSchema.optional(), password: z.string().min(1).max(256).optional() }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(createdShareDataSchema) },
  'document.unshare': { description: 'Revoke document shares.', input: z.object({ shareKeys: keysSchema.optional(), documentKeys: keysSchema.optional(), atomic: atomicSchema, ...idempotencyShape }).strict().refine((value) => Number(value.shareKeys !== undefined) + Number(value.documentKeys !== undefined) === 1, 'exactly one of shareKeys or documentKeys is required'), output: contentBatchOutputSchema(unsharedDataSchema) },
  'document.list-shares': { description: 'List shares for documents.', input: z.object({ documentKeys: keysSchema, includeExpired: z.boolean().optional(), includeRevoked: z.boolean().optional() }).strict(), output: contentBatchOutputSchema(z.object({ documentKey: keySchema, shares: z.array(contentDocumentShareSchema) }).strict()) },
  'document.create-version': { description: 'Create document versions.', input: z.object({ documentKeys: keysSchema, labels: z.record(z.string().trim().min(1).max(120)).optional(), atomic: atomicSchema, ...idempotencyShape }).strict().superRefine((value, context) => {
    for (const key of Object.keys(value.labels ?? {})) if (!value.documentKeys.includes(key)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['labels', key], message: 'label key must be one of documentKeys' });
  }), output: contentBatchOutputSchema(versionDataSchema) },
  'document.find-version': { description: 'Find document versions by key.', input: z.object({ versionKeys: keysSchema, include: z.array(z.enum(['html', 'content', 'embedding'])).min(1).optional() }).strict(), output: contentBatchOutputSchema(projectedVersionDataSchema) },
  'document.list-versions': { description: 'List ordered versions grouped by document.', input: z.object({ documentKeys: keysSchema, cursor: cursorSchema.optional(), limit: limitSchema.optional() }).strict(), output: contentBatchOutputSchema(z.object({ documentKey: keySchema, versions: z.array(contentDocumentVersionSchema), cursor: cursorSchema.optional() }).strict()) },
  'document.restore-version': { description: 'Restore document versions.', input: z.object({ restores: z.array(z.object({ documentKey: keySchema, versionKey: keySchema, createBackupVersion: z.boolean().default(true) }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(documentDataSchema) },
  'document.delete-version': { description: 'Delete document versions.', input: z.object({ versionKeys: keysSchema, atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(emptyDataSchema) },
  'document.summarize': { description: 'Summarize documents.', input: z.object({ documentKeys: keysSchema, style: z.enum(['brief', 'detailed', 'executive', 'bullet-points', 'technical']).optional(), language: textSchema.optional(), persist: z.boolean().optional(), combine: z.boolean().optional(), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(generatedTextDataSchema) },
  'document.translate': { description: 'Translate documents.', input: z.object({ documentKeys: keysSchema, targetLanguage: textSchema, sourceLanguage: textSchema.optional(), preserveFormatting: z.boolean().optional(), mode: z.enum(['preview', 'replace', 'copy']).default('preview'), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(generatedTextDataSchema) },
  'document.rewrite': { description: 'Rewrite documents from an instruction.', input: z.object({ rewrites: z.array(z.object({ documentKey: keySchema, instruction: textSchema.max(8_000), tone: textSchema.optional(), audience: textSchema.optional(), length: z.enum(['shorter', 'same', 'longer']).optional(), mode: z.enum(['preview', 'replace', 'copy']).default('preview') }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: contentBatchOutputSchema(generatedTextDataSchema) },
  'scope.document.search': { description: 'Search documents available from a scope.', input: z.object({ scopeKey: keySchema, ...searchInputShape }).strict(), output: contentSearchOutputSchema },
  'scope.content.search': { description: 'Search authorized documents in a scope or folder hierarchy with query-relative summaries.', input: z.object({ scopeKey: keySchema, query: textSchema.max(8_000), folderKey: keySchema.optional(), includeDescendants: z.boolean().optional(), minimumScore: z.number().min(0).max(1).default(0.55) }).strict().superRefine((value, context) => { if (!value.folderKey && value.includeDescendants !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['includeDescendants'], message: 'includeDescendants requires folderKey' }); }), output: scopeContentSearchOutputSchema },
  'scope.content.search-history': { description: 'List the current user\'s search history in a scope.', input: z.object({ scopeKey: keySchema, folderKey: keySchema.optional(), includeDescendants: z.boolean().optional(), limit: z.number().int().min(1).max(100).default(20) }).strict().superRefine((value, context) => { if (!value.folderKey && value.includeDescendants !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['includeDescendants'], message: 'includeDescendants requires folderKey' }); }), output: z.object({ history: z.array(contentSearchHistoryItemSchema) }).strict() },
  'organization.document.search': { description: 'Search documents across an organization.', input: z.object({ organizationKey: keySchema, ...searchInputShape, filters: organizationContentSearchFiltersSchema.optional(), include: organizationSearchIncludeSchema.optional() }).strict(), output: contentSearchOutputSchema },
} as const satisfies Record<string, { description: string; input: z.ZodTypeAny; output: z.ZodTypeAny }>;

export type ContentToolName = keyof typeof contentToolContracts;
export type ContentToolInput<Name extends ContentToolName> = z.input<(typeof contentToolContracts)[Name]['input']>;
export type ContentToolOutput<Name extends ContentToolName> = z.output<(typeof contentToolContracts)[Name]['output']>;
