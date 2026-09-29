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
  isFavorite: z.boolean().default(false),
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
  processing: z.enum(['pending', 'ready', 'failed']),
  isFavorite: z.boolean().default(false),
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
  'folder.create': { description: 'Create folders in the current scope.', input: z.object({ scopeKey: keySchema, folders: z.array(z.object({ scopeKey: keySchema, parentFolderKey: keySchema.optional(), name: nameSchema, description: z.string().trim().min(1).optional() }).strict()).min(1).max(100), ...idempotencyShape }).strict(), output: contentBatchOutputSchema(folderDataSchema) },
  'folder.list': { description: 'List folders at a location.', input: z.object({ scopeKey: keySchema, folderKey: keySchema.optional(), cursor: cursorSchema.optional(), limit: limitSchema.optional(), ...creationDateRangeShape }).strict().superRefine(validateCreationDateRange), output: z.object({ folders: z.array(contentFolderSchema), cursor: cursorSchema.optional() }).strict() },
  'folder.find': { description: 'Find one folder.', input: z.object({ folderKey: keySchema }).strict(), output: z.object({ folder: contentFolderSchema }).strict() },
  'folder.update': { description: 'Update folder metadata.', input: z.object({ folderKey: keySchema, name: nameSchema.optional(), description: z.string().trim().min(1).nullable().optional(), isFavorite: z.boolean().optional() }).strict(), output: z.object({ folder: contentFolderSchema }).strict() },
  'folder.rename': { description: 'Rename a folder.', input: z.object({ folderKey: keySchema, name: nameSchema }).strict(), output: z.object({ folder: contentFolderSchema }).strict() },
  'folder.move': { description: 'Move a folder.', input: z.object({ folderKey: keySchema, parentFolderKey: keySchema.nullable() }).strict(), output: z.object({ folder: contentFolderSchema }).strict() },
  'folder.delete': { description: 'Delete a folder and its contents.', input: z.object({ folderKey: keySchema }).strict(), output: z.object({ deleted: z.literal(true) }).strict() },
  'file.list': { description: 'List files at a location.', input: z.object({ scopeKey: keySchema, folderKey: keySchema.optional(), cursor: cursorSchema.optional(), limit: limitSchema.optional(), extensions: z.array(fileExtensionSchema).min(1).optional(), ...creationDateRangeShape }).strict().superRefine(validateCreationDateRange), output: z.object({ files: z.array(contentFileSchema), cursor: cursorSchema.optional() }).strict() },
  'file.find': { description: 'Find one file.', input: z.object({ fileKey: keySchema }).strict(), output: z.object({ file: contentFileSchema }).strict() },
  'file.update': { description: 'Update file metadata.', input: z.object({ fileKey: keySchema, name: nameSchema.optional(), isFavorite: z.boolean().optional() }).strict(), output: z.object({ file: contentFileSchema }).strict() },
  'file.rename': { description: 'Rename a file.', input: z.object({ fileKey: keySchema, name: nameSchema }).strict(), output: z.object({ file: contentFileSchema }).strict() },
  'file.move': { description: 'Move a file.', input: z.object({ fileKey: keySchema, folderKey: keySchema.nullable() }).strict(), output: z.object({ file: contentFileSchema }).strict() },
  'file.delete': { description: 'Delete a file.', input: z.object({ fileKey: keySchema }).strict(), output: z.object({ deleted: z.literal(true) }).strict() },
  'file.download': { description: 'Get a download URL for a file.', input: z.object({ fileKey: keySchema }).strict(), output: z.object({ fileKey: keySchema, url: z.string().url(), fileName: nameSchema, mimeType: z.string() }).strict() },
} as const;

export type ContentToolName = keyof typeof contentToolContracts;
export type ContentToolInput<Name extends ContentToolName> = z.input<(typeof contentToolContracts)[Name]['input']>;
export type ContentToolOutput<Name extends ContentToolName> = z.output<(typeof contentToolContracts)[Name]['output']>;
