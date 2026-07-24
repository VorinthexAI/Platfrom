import { z } from 'zod';

const key = z.string().cuid();
const lifecycleBatch = (field: string) => z.object({ items: z.array(z.object({ [field]: key }).strict()).min(1).max(100), atomic: z.boolean().default(true) }).strict()
  .refine((value) => new Set(value.items.map((item) => item[field])).size === value.items.length, 'Duplicate resource keys are not allowed.');

export const archiveToolInputSchemas = {
  'folder.archive': lifecycleBatch('folderKey'),
  'folder.restore': lifecycleBatch('folderKey'),
  'document.archive': lifecycleBatch('documentKey'),
  'document.restore': lifecycleBatch('documentKey'),
  'document-version.archive': lifecycleBatch('documentVersionKey'),
  'document-version.restore': lifecycleBatch('documentVersionKey'),
  'document-share.archive': lifecycleBatch('documentShareKey'),
  'document-share.restore': lifecycleBatch('documentShareKey'),
} as const;

const lifecycleJson = (field: string) => ({ type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: [field], properties: { [field]: { type: 'string' } } } }, atomic: { type: 'boolean', default: true } } });

export const archiveToolJsonSchemas = {
  'folder.archive': lifecycleJson('folderKey'),
  'folder.restore': lifecycleJson('folderKey'),
  'document.archive': lifecycleJson('documentKey'),
  'document.restore': lifecycleJson('documentKey'),
  'document-version.archive': lifecycleJson('documentVersionKey'),
  'document-version.restore': lifecycleJson('documentVersionKey'),
  'document-share.archive': lifecycleJson('documentShareKey'),
  'document-share.restore': lifecycleJson('documentShareKey'),
} as const;

export type ArchiveActionSlug = keyof typeof archiveToolInputSchemas;
export const isArchiveAction = (action: string): action is ArchiveActionSlug => action in archiveToolInputSchemas;
