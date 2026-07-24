import { z } from 'zod';
import { documentProcessingInputSchema } from '@/lib/ai/document-processing/schemas';
import { editorDocumentJsonSchema, documentExtensionSchema } from '@/lib/ai/document-processing/schemas';
import { documentErrorSchema } from './document-tool-errors';

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

export const documentFolderSchema = z.object({
  key: keySchema,
  scopeKey: keySchema,
  parentFolderKey: keySchema.optional(),
  name: nameSchema,
  description: textSchema.optional(),
  deletedAt: dateTimeSchema.nullable().default(null),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  childrenCount: z.number().int().nonnegative().optional(),
  documentCount: z.number().int().nonnegative().optional(),
}).strict();

export const documentDocumentShareSchema = z.object({
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

export const documentDocumentVersionSchema = z.object({
  key: keySchema,
  scopeKey: keySchema,
  documentKey: keySchema,
  version: z.number().int().positive(),
  label: z.string().trim().min(1).max(120).optional(),
  storageKey: textSchema.optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  deletedAt: dateTimeSchema.nullable().default(null),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema.optional(),
}).strict();

export const documentProjectedDocumentVersionSchema = documentDocumentVersionSchema.extend({
  html: z.string().optional(),
  json: editorDocumentJsonSchema.optional(),
  content: z.string().optional(),
  embedding: z.array(z.number().finite()).min(1).optional(),
}).strict();

export const documentDocumentSchema = z.object({
  key: keySchema,
  scopeKey: keySchema,
  folderKey: keySchema,
  name: nameSchema,
  extension: documentExtensionSchema,
  mimeType: textSchema,
  sizeBytes: z.number().int().positive(),
  deletedAt: dateTimeSchema.nullable().default(null),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
}).strict();

export const documentProjectedDocumentSchema = documentDocumentSchema.extend({
  html: z.string().optional(),
  json: editorDocumentJsonSchema.optional(),
  content: z.string().optional(),
  embedding: z.array(z.number().finite()).min(1).optional(),
  folder: documentFolderSchema.optional(),
  shares: z.array(documentDocumentShareSchema).optional(),
  latestVersion: documentDocumentVersionSchema.optional(),
}).strict();

export const documentBatchSummarySchema = z.object({
  requested: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
}).strict().refine((value) => value.succeeded + value.failed === value.requested, 'succeeded and failed must equal requested');

export function documentBatchResultSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    key: keySchema,
    success: z.boolean(),
    data: dataSchema.optional(),
    error: documentErrorSchema.optional(),
  }).strict().superRefine((value, context) => {
    if (value.success && value.error) context.addIssue({ code: z.ZodIssueCode.custom, message: 'successful results cannot contain an error' });
    if (!value.success && !value.error) context.addIssue({ code: z.ZodIssueCode.custom, message: 'failed results require an error' });
    if (!value.success && value.data !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: 'failed results cannot contain data' });
  });
}

export function documentBatchOutputSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({ results: z.array(documentBatchResultSchema(dataSchema)), summary: documentBatchSummarySchema }).strict().superRefine((value, context) => {
    if (value.results.length !== value.summary.requested) context.addIssue({ code: z.ZodIssueCode.custom, message: 'results must contain one item per requested resource' });
    if (value.results.filter((result) => result.success).length !== value.summary.succeeded) context.addIssue({ code: z.ZodIssueCode.custom, message: 'result statuses must match summary counts' });
  });
}

const emptyDataSchema = z.object({}).strict();
const folderDataSchema = z.object({ folder: documentFolderSchema }).strict();
const documentDataSchema = z.object({ document: documentDocumentSchema }).strict();
const projectedDocumentDataSchema = z.object({ document: documentProjectedDocumentSchema }).strict();
const shareDataSchema = z.object({ share: documentDocumentShareSchema }).strict();
const unsharedDataSchema = z.union([
  shareDataSchema,
  z.object({ documentKey: keySchema, shares: z.array(documentDocumentShareSchema) }).strict(),
]);
const createdShareDataSchema = z.object({
  share: documentDocumentShareSchema,
  token: z.string().min(32),
}).strict();
const copiedDocumentDataSchema = z.object({
  document: documentDocumentSchema,
  shares: z.array(createdShareDataSchema).optional(),
}).strict();
const versionDataSchema = z.object({ version: documentDocumentVersionSchema }).strict();
const projectedVersionDataSchema = z.object({ version: documentProjectedDocumentVersionSchema }).strict();
const fileDataSchema = z.object({ documentKey: keySchema, format: z.string().trim().min(1), fileName: nameSchema, mimeType: textSchema, encoding: z.literal('base64'), content: z.string() }).strict();
const generatedTextDataSchema = z.object({ documentKey: keySchema, text: z.string(), language: z.string().trim().min(1).optional(), persistedDocumentKey: keySchema.optional() }).strict();

const folderUpdateSchema = z.object({ folderKey: keySchema, name: nameSchema.optional(), description: textSchema.nullable().optional() }).strict()
  .refine((value) => value.name !== undefined || value.description !== undefined, 'name or description is required');
const documentUpdateSchema = z.object({
  documentKey: keySchema,
  html: z.string().min(1).optional(),
  json: editorDocumentJsonSchema.optional(),
  content: z.string().min(1).optional(),
  createVersion: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  const representations = [value.html, value.json, value.content].filter((item) => item !== undefined).length;
  if (representations === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: 'one document representation is required' });
  if (representations > 1) context.addIssue({ code: z.ZodIssueCode.custom, message: 'html, json, and content are mutually exclusive' });
});

export const documentSearchSourceSchema = z.discriminatedUnion('type', [
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
export const documentSearchFiltersSchema = z.object(commonSearchFilterShape).strict();
export const organizationDocumentSearchFiltersSchema = z.object({
  ...commonSearchFilterShape,
  scopeKeys: keysSchema.optional(),
  projectKeys: keysSchema.optional(),
  folderKeys: keysSchema.optional(),
}).strict();
const searchIncludeSchema = z.array(z.enum(['snippet', 'content', 'html', 'folder', 'scoreBreakdown'])).min(1);
const organizationSearchIncludeSchema = z.array(z.enum(['snippet', 'content', 'html', 'folder', 'scoreBreakdown', 'scope'])).min(1);
const searchInputShape = {
  query: textSchema.max(8_000),
  sources: z.array(documentSearchSourceSchema).min(1).optional(),
  filters: documentSearchFiltersSchema.optional(),
  topK: z.number().int().min(1).max(100).optional(),
  minimumScore: z.number().min(0).max(1).optional(),
  include: searchIncludeSchema.optional(),
};

const normalizedScoreSchema = z.number().min(0).max(1);
const searchScoreBreakdownSchema = z.object({ vector: normalizedScoreSchema.optional(), lexical: normalizedScoreSchema.optional(), recency: normalizedScoreSchema.optional(), final: normalizedScoreSchema }).strict();
export const documentSearchResultSchema = z.object({
  documentKey: keySchema,
  name: nameSchema,
  scopeKey: keySchema,
  folderKey: keySchema,
  score: normalizedScoreSchema,
  snippet: z.string().optional(),
  content: z.string().optional(),
  html: z.string().optional(),
  folder: documentFolderSchema.optional(),
  scope: z.object({ key: keySchema }).strict().optional(),
  matchedSource: z.object({ type: z.enum(['scope', 'project', 'folder']), key: keySchema }).strict().optional(),
  scoreBreakdown: searchScoreBreakdownSchema.optional(),
}).strict();
export const documentSearchOutputSchema = z.object({ query: textSchema, results: z.array(documentSearchResultSchema), totalCandidates: z.number().int().nonnegative().optional() }).strict();

const documentReadDataSchema = z.union([
  z.object({ documentKey: keySchema, title: nameSchema, content: z.string() }).strict(),
  z.object({ documentKey: keySchema, title: nameSchema, html: z.string() }).strict(),
  z.object({ documentKey: keySchema, title: nameSchema, json: editorDocumentJsonSchema }).strict(),
  z.object({
    documentKey: keySchema,
    title: nameSchema,
    audio: z.array(z.object({ index: z.number().int().nonnegative(), storageKey: textSchema.optional(), url: z.string().url().optional(), durationMs: z.number().int().nonnegative().optional(), startCharacter: z.number().int().nonnegative(), endCharacter: z.number().int().nonnegative() }).strict()),
    totalDurationMs: z.number().int().nonnegative().optional(),
  }).strict(),
]);

export const documentToolContracts = {
  'folder.create': { description: 'Create one or more Document folders.', input: z.object({ folders: z.array(z.object({ key: keySchema.optional(), scopeKey: keySchema, parentFolderKey: keySchema.optional(), name: nameSchema, description: textSchema.optional() }).strict()).min(1).max(100), ...idempotencyShape }).strict(), output: documentBatchOutputSchema(folderDataSchema) },
  'folder.find': { description: 'Find Document folders by key.', input: z.object({ folderKeys: keysSchema, includeArchived: z.boolean().optional(), includeChildrenCount: z.boolean().optional(), includeDocumentCount: z.boolean().optional() }).strict(), output: documentBatchOutputSchema(folderDataSchema) },
  'folder.list': { description: 'List folders under a scope or parent folder.', input: z.object({ scopeKey: keySchema, parentFolderKey: keySchema.optional(), includeArchived: z.boolean().optional(), includeDocuments: z.boolean().optional(), cursor: cursorSchema.optional(), limit: limitSchema.optional(), sort: folderSortSchema.optional() }).strict(), output: z.object({ folders: z.array(documentFolderSchema), documents: z.array(documentDocumentSchema).optional(), cursor: cursorSchema.optional() }).strict() },
  'folder.update': { description: 'Update folder metadata.', input: z.object({ updates: z.array(folderUpdateSchema).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(folderDataSchema) },
  'folder.rename': { description: 'Rename folders.', input: z.object({ renames: z.array(z.object({ folderKey: keySchema, name: nameSchema }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(folderDataSchema) },
  'folder.move': { description: 'Move folders to another parent or the scope root.', input: z.object({ moves: z.array(z.object({ folderKey: keySchema, targetParentFolderKey: keySchema.optional() }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(folderDataSchema) },
  'folder.archive': { description: 'Mark folders as archived.', input: z.object({ folderKeys: keysSchema, includeDescendants: z.boolean().optional(), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(folderDataSchema) },
  'folder.restore': { description: 'Restore archived folders.', input: z.object({ folderKeys: keysSchema, includeDescendants: z.boolean().optional(), restoreAncestors: z.boolean().optional(), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(folderDataSchema) },
  'folder.delete': { description: 'Permanently delete folders.', input: z.object({ folderKeys: keysSchema, recursive: z.boolean().optional(), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(emptyDataSchema) },
  'document.processing': { description: 'Validate, store, extract, transform, embed, and insert a document.', input: documentProcessingInputSchema.extend(idempotencyShape), output: z.object({ document: documentDocumentSchema }).strict() },
  'document.find': { description: 'Find documents by key.', input: z.object({ documentKeys: keysSchema, includeArchived: z.boolean().optional(), include: z.array(z.enum(['html', 'json', 'content', 'embedding', 'folder', 'shares', 'latestVersion'])).min(1).optional() }).strict(), output: documentBatchOutputSchema(projectedDocumentDataSchema) },
  'document.list': { description: 'List documents in a folder.', input: z.object({ folderKey: keySchema, includeArchived: z.boolean().optional(), cursor: cursorSchema.optional(), limit: limitSchema.optional(), sort: documentSortSchema.optional(), extensions: z.array(documentExtensionSchema).min(1).optional() }).strict(), output: z.object({ documents: z.array(documentDocumentSchema), cursor: cursorSchema.optional() }).strict() },
  'document.read': { description: 'Read document content or generate chunked audio.', input: z.object({ documentKeys: keysSchema, mode: z.enum(['content', 'html', 'json', 'audio']).default('content'), language: textSchema.optional(), voice: textSchema.optional(), speakingRate: z.number().min(0.25).max(4).optional(), startOffset: z.number().int().nonnegative().optional(), endOffset: z.number().int().positive().optional(), includeTitle: z.boolean().optional(), includeCode: z.boolean().optional(), persistAudio: z.boolean().optional(), atomic: atomicSchema, ...idempotencyShape }).strict().superRefine((value, context) => {
    if (value.endOffset !== undefined && value.startOffset !== undefined && value.endOffset <= value.startOffset) context.addIssue({ code: z.ZodIssueCode.custom, message: 'endOffset must be greater than startOffset' });
    if (value.mode !== 'audio') {
      for (const field of ['language', 'voice', 'speakingRate', 'startOffset', 'endOffset', 'includeTitle', 'includeCode', 'persistAudio'] as const) {
        if (value[field] !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is only valid in audio mode` });
      }
    }
  }), output: documentBatchOutputSchema(documentReadDataSchema) },
  'document.update': { description: 'Update document content.', input: z.object({ updates: z.array(documentUpdateSchema).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(documentDataSchema) },
  'document.rename': { description: 'Rename documents.', input: z.object({ renames: z.array(z.object({ documentKey: keySchema, name: nameSchema }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(documentDataSchema) },
  'document.move': { description: 'Move documents to another folder.', input: z.object({ moves: z.array(z.object({ documentKey: keySchema, targetFolderKey: keySchema }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(documentDataSchema) },
  'document.copy': { description: 'Copy documents.', input: z.object({ copies: z.array(z.object({ documentKey: keySchema, targetFolderKey: keySchema, newName: nameSchema.optional(), includeVersions: z.boolean().default(false), includeShares: z.boolean().default(false) }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(copiedDocumentDataSchema) },
  'document.archive': { description: 'Mark documents as archived.', input: z.object({ documentKeys: keysSchema, atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(documentDataSchema) },
  'document.restore': { description: 'Restore archived documents.', input: z.object({ documentKeys: keysSchema, restoreAncestors: z.boolean().optional(), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(documentDataSchema) },
  'document.delete': { description: 'Permanently delete documents and optionally their versions and shares.', input: z.object({ documentKeys: keysSchema, deleteVersions: z.boolean().optional(), deleteShares: z.boolean().optional(), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(emptyDataSchema) },
  'document.download': { description: 'Download documents.', input: z.object({ documentKeys: keysSchema, format: z.enum(['original', 'html', 'txt', 'md']).default('original') }).strict(), output: documentBatchOutputSchema(fileDataSchema) },
  'document.export': { description: 'Export documents to selected formats.', input: z.object({ exports: z.array(z.object({ documentKey: keySchema, format: z.enum(['html', 'txt', 'md', 'pdf', 'docx']) }).strict()).min(1).max(100), atomic: atomicSchema }).strict(), output: documentBatchOutputSchema(fileDataSchema) },
  'document.share': { description: 'Create document shares.', input: z.object({ shares: z.array(z.object({ documentKey: keySchema, permission: z.enum(['read', 'comment']), expiresAt: dateTimeSchema.optional(), password: z.string().min(1).max(256).optional() }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(createdShareDataSchema) },
  'document.unshare': { description: 'Revoke document shares.', input: z.object({ shareKeys: keysSchema.optional(), documentKeys: keysSchema.optional(), atomic: atomicSchema, ...idempotencyShape }).strict().refine((value) => Number(value.shareKeys !== undefined) + Number(value.documentKeys !== undefined) === 1, 'exactly one of shareKeys or documentKeys is required'), output: documentBatchOutputSchema(unsharedDataSchema) },
  'document.list-shares': { description: 'List shares for documents.', input: z.object({ documentKeys: keysSchema, includeExpired: z.boolean().optional(), includeRevoked: z.boolean().optional() }).strict(), output: documentBatchOutputSchema(z.object({ documentKey: keySchema, shares: z.array(documentDocumentShareSchema) }).strict()) },
  'document.create-version': { description: 'Create document versions.', input: z.object({ documentKeys: keysSchema, labels: z.record(z.string().trim().min(1).max(120)).optional(), atomic: atomicSchema, ...idempotencyShape }).strict().superRefine((value, context) => {
    for (const key of Object.keys(value.labels ?? {})) if (!value.documentKeys.includes(key)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['labels', key], message: 'label key must be one of documentKeys' });
  }), output: documentBatchOutputSchema(versionDataSchema) },
  'document.find-version': { description: 'Find document versions by key.', input: z.object({ versionKeys: keysSchema, include: z.array(z.enum(['html', 'json', 'content', 'embedding'])).min(1).optional() }).strict(), output: documentBatchOutputSchema(projectedVersionDataSchema) },
  'document.list-versions': { description: 'List ordered versions grouped by document.', input: z.object({ documentKeys: keysSchema, cursor: cursorSchema.optional(), limit: limitSchema.optional() }).strict(), output: documentBatchOutputSchema(z.object({ documentKey: keySchema, versions: z.array(documentDocumentVersionSchema), cursor: cursorSchema.optional() }).strict()) },
  'document.restore-version': { description: 'Restore document versions.', input: z.object({ restores: z.array(z.object({ documentKey: keySchema, versionKey: keySchema, createBackupVersion: z.boolean().default(true) }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(documentDataSchema) },
  'document.delete-version': { description: 'Delete document versions.', input: z.object({ versionKeys: keysSchema, atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(emptyDataSchema) },
  'document.summarize': { description: 'Summarize documents.', input: z.object({ documentKeys: keysSchema, style: z.enum(['brief', 'detailed', 'executive', 'bullet-points', 'technical']).optional(), language: textSchema.optional(), persist: z.boolean().optional(), combine: z.boolean().optional(), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(generatedTextDataSchema) },
  'document.translate': { description: 'Translate documents.', input: z.object({ documentKeys: keysSchema, targetLanguage: textSchema, sourceLanguage: textSchema.optional(), preserveFormatting: z.boolean().optional(), mode: z.enum(['preview', 'replace', 'copy']).default('preview'), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(generatedTextDataSchema) },
  'document.rewrite': { description: 'Rewrite documents from an instruction.', input: z.object({ rewrites: z.array(z.object({ documentKey: keySchema, instruction: textSchema.max(8_000), tone: textSchema.optional(), audience: textSchema.optional(), length: z.enum(['shorter', 'same', 'longer']).optional(), mode: z.enum(['preview', 'replace', 'copy']).default('preview') }).strict()).min(1).max(100), atomic: atomicSchema, ...idempotencyShape }).strict(), output: documentBatchOutputSchema(generatedTextDataSchema) },
  'scope.document.search': { description: 'Search documents available from a scope.', input: z.object({ scopeKey: keySchema, ...searchInputShape }).strict(), output: documentSearchOutputSchema },
  'organization.document.search': { description: 'Search documents across an organization.', input: z.object({ organizationKey: keySchema, ...searchInputShape, filters: organizationDocumentSearchFiltersSchema.optional(), include: organizationSearchIncludeSchema.optional() }).strict(), output: documentSearchOutputSchema },
} as const satisfies Record<string, { description: string; input: z.ZodTypeAny; output: z.ZodTypeAny }>;

export type DocumentToolName = keyof typeof documentToolContracts;
export type DocumentToolInput<Name extends DocumentToolName> = z.input<(typeof documentToolContracts)[Name]['input']>;
export type DocumentToolOutput<Name extends DocumentToolName> = z.output<(typeof documentToolContracts)[Name]['output']>;
