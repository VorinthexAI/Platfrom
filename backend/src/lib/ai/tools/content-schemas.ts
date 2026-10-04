import { z } from 'zod';
import { fileExtensionSchema } from '@/lib/db/files.node';
import { contentErrorSchema } from './content-errors';

const keySchema = z.string().cuid();
const nameSchema = z.string().trim().min(1).max(255);
const cursorSchema = z.string().trim().min(1);
const limitSchema = z.number().int().min(1).max(100);
const dateTimeSchema = z.string().datetime();
const idempotencyShape = { idempotencyKey: z.string().trim().min(1).max(200).optional() } as const;
const creationDateRangeShape = { createdFrom: dateTimeSchema.optional(), createdTo: dateTimeSchema.optional() } as const;
export const validateCreationDateRange = (value: { createdFrom?: string; createdTo?: string }, context: z.RefinementCtx) => {
  if (value.createdFrom && value.createdTo && Date.parse(value.createdFrom) > Date.parse(value.createdTo)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['createdTo'], message: 'createdTo must not precede createdFrom.' });
  }
};

export const contentFolderSchema = z.object({
  key: keySchema,
  scopeKey: keySchema,
  parentFolderKey: keySchema.optional(),
  name: nameSchema,
  description: z.string().trim().min(1).optional(),
  coverFileKey: keySchema.optional(),
  isFavorite: z.boolean().default(false),
  isHidden: z.boolean().default(false),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
}).strict();

export const contentFileSchema = z.object({
  key: keySchema,
  scopeKey: keySchema,
  folderKey: keySchema.optional(),
  name: nameSchema,
  extension: fileExtensionSchema,
  mimeType: z.string().trim().min(1),
  sizeBytes: z.number().int().positive(),
  caption: z.string().trim().min(1).max(20_000).optional(),
  hasThumbnail: z.boolean().default(false),
  hasExtractedText: z.boolean().default(false),
  processing: z.enum(['pending', 'ready', 'failed']),
  isFavorite: z.boolean().default(false),
  isHidden: z.boolean().default(false),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
}).strict();

export const contentSearchHistoryItemSchema = z.object({
  query: z.string().trim().min(1),
  normalizedQuery: z.string().trim().min(1),
  searchedAt: dateTimeSchema,
  usageCount: z.number().int().positive(),
}).strict();

export const contentTagSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000).optional(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
}).strict();

export const contentBatchSummarySchema = z.object({
  requested: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
}).strict();

export function contentBatchResultSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    key: keySchema,
    success: z.boolean(),
    data: dataSchema.optional(),
    error: contentErrorSchema.optional(),
  }).strict();
}

export function contentBatchOutputSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({ results: z.array(contentBatchResultSchema(dataSchema)), summary: contentBatchSummarySchema }).strict();
}

const folderDataSchema = z.object({ folder: contentFolderSchema }).strict();
const fileDataSchema = z.object({ file: contentFileSchema }).strict();

export const contentToolContracts = {
  'folder.create': { description: 'Create folders in the current scope.', input: z.object({ scopeKey: keySchema, folders: z.array(z.object({ key: keySchema.optional(), scopeKey: keySchema, parentFolderKey: keySchema.optional(), name: nameSchema, description: z.string().trim().min(1).optional() }).strict()).min(1).max(100), ...idempotencyShape }).strict(), output: contentBatchOutputSchema(folderDataSchema) },
  'folder.list': { description: 'List folders at a location.', input: z.object({ scopeKey: keySchema, folderKey: keySchema.optional(), cursor: cursorSchema.optional(), limit: limitSchema.optional(), favoritesOnly: z.boolean().optional(), includeHidden: z.boolean().optional(), ...creationDateRangeShape }).strict().superRefine(validateCreationDateRange), output: z.object({ folders: z.array(contentFolderSchema), cursor: cursorSchema.optional() }).strict() },
  'folder.find': { description: 'Find one folder.', input: z.object({ folderKey: keySchema }).strict(), output: z.object({ folder: contentFolderSchema }).strict() },
  'folder.update': { description: 'Update folder metadata.', input: z.object({ folderKey: keySchema, name: nameSchema.optional(), description: z.string().trim().min(1).nullable().optional(), coverFileKey: keySchema.nullable().optional(), isFavorite: z.boolean().optional(), isHidden: z.boolean().optional() }).strict(), output: z.object({ folder: contentFolderSchema }).strict() },
  'folder.rename': { description: 'Rename a folder.', input: z.object({ folderKey: keySchema, name: nameSchema }).strict(), output: z.object({ folder: contentFolderSchema }).strict() },
  'folder.move': { description: 'Move a folder.', input: z.object({ folderKey: keySchema, parentFolderKey: keySchema.nullable() }).strict(), output: z.object({ folder: contentFolderSchema }).strict() },
  'folder.copy': { description: 'Copy a folder and its contents.', input: z.object({ folderKey: keySchema, parentFolderKey: keySchema.nullable() }).strict(), output: z.object({ folder: contentFolderSchema }).strict() },
  'folder.delete': { description: 'Delete a folder and its contents.', input: z.object({ folderKey: keySchema }).strict(), output: z.object({ deleted: z.literal(true) }).strict() },
  'file.list': { description: 'List files at a location or across its nested folders.', input: z.object({ scopeKey: keySchema, folderKey: keySchema.optional(), cursor: cursorSchema.optional(), limit: limitSchema.optional(), extensions: z.array(fileExtensionSchema).min(1).optional(), includeDescendants: z.boolean().optional(), favoritesOnly: z.boolean().optional(), includeHidden: z.boolean().optional(), ...creationDateRangeShape }).strict().superRefine(validateCreationDateRange), output: z.object({ files: z.array(contentFileSchema), cursor: cursorSchema.optional(), count: z.number().int().nonnegative().optional() }).strict() },
  'file.find': { description: 'Find one file.', input: z.object({ fileKey: keySchema }).strict(), output: z.object({ file: contentFileSchema }).strict() },
  'file.update': { description: 'Update file metadata.', input: z.object({ fileKey: keySchema, name: nameSchema.optional(), isFavorite: z.boolean().optional(), isHidden: z.boolean().optional() }).strict(), output: z.object({ file: contentFileSchema }).strict() },
  'file.rename': { description: 'Rename a file.', input: z.object({ fileKey: keySchema, name: nameSchema }).strict(), output: z.object({ file: contentFileSchema }).strict() },
  'file.move': { description: 'Move a file.', input: z.object({ fileKey: keySchema, folderKey: keySchema.nullable() }).strict(), output: z.object({ file: contentFileSchema }).strict() },
  'file.copy': { description: 'Copy a file.', input: z.object({ fileKey: keySchema, folderKey: keySchema.nullable() }).strict(), output: z.object({ file: contentFileSchema }).strict() },
  'file.delete': { description: 'Delete a file.', input: z.object({ fileKey: keySchema }).strict(), output: z.object({ deleted: z.literal(true) }).strict() },
  'file.download': { description: 'Get a download URL for a file.', input: z.object({ fileKey: keySchema }).strict(), output: z.object({ fileKey: keySchema, url: z.string().url(), thumbnailUrl: z.string().url().optional(), fileName: nameSchema, mimeType: z.string() }).strict() },
  'content.search': { description: 'Semantically search folders and files in the current scope.', input: z.object({ scopeKey: keySchema, query: z.string().trim().min(1).max(500), folderKey: keySchema.optional(), favoritesOnly: z.boolean().optional(), includeHidden: z.boolean().optional(), tagKeys: z.array(keySchema).min(1).max(20).optional(), extensions: z.array(fileExtensionSchema).min(1).optional(), limit: limitSchema.optional() }).strict(), output: z.object({ query: z.string(), folders: z.array(contentFolderSchema.extend({ score: z.number() }).strict()), files: z.array(contentFileSchema.extend({ score: z.number() }).strict()) }).strict() },
  'content.search-history.record': { description: 'Save a completed user search to private history.', input: z.object({ scopeKey: keySchema, query: z.string().trim().min(1).max(500) }).strict(), output: z.object({ item: contentSearchHistoryItemSchema }).strict() },
  'content.search-history.list': { description: 'List recent content searches for the current user.', input: z.object({ scopeKey: keySchema, limit: limitSchema.optional() }).strict(), output: z.object({ items: z.array(contentSearchHistoryItemSchema) }).strict() },
  'content.search-history.delete': { description: 'Delete a content search history item.', input: z.object({ scopeKey: keySchema, normalizedQuery: z.string().trim().min(1).max(12_000) }).strict(), output: z.object({ deleted: z.boolean() }).strict() },
  'tag.list': { description: 'List tags in the current scope.', input: z.object({ scopeKey: keySchema }).strict(), output: z.object({ items: z.array(contentTagSchema) }).strict() },
  'tag.create': { description: 'Create a tag in the current scope.', input: z.object({ scopeKey: keySchema, key: keySchema.optional(), name: z.string().trim().min(1).max(120) }).strict(), output: z.object({ tag: contentTagSchema }).strict() },
  'tag.assignment.list': { description: 'List tag assignments for selected folders and files.', input: z.object({ scopeKey: keySchema, targets: z.array(z.object({ type: z.enum(['folder', 'file']), key: keySchema }).strict()).min(1).max(100) }).strict(), output: z.object({ items: z.array(z.object({ target: z.object({ type: z.enum(['folder', 'file']), key: keySchema }).strict(), tagKeys: z.array(keySchema) }).strict()) }).strict() },
  'tag.assignment.set': { description: 'Set tag assignments for folders or files.', input: z.object({ scopeKey: keySchema, targets: z.array(z.object({ type: z.enum(['folder', 'file']), key: keySchema }).strict()).min(1).max(100), tagKeys: z.array(keySchema).min(1).max(100), assigned: z.boolean() }).strict(), output: z.object({ changedCount: z.number().int().nonnegative() }).strict() },
} as const;

export type ContentToolName = keyof typeof contentToolContracts;
export type ContentToolInput<Name extends ContentToolName> = z.input<(typeof contentToolContracts)[Name]['input']>;
export type ContentToolOutput<Name extends ContentToolName> = z.output<(typeof contentToolContracts)[Name]['output']>;
