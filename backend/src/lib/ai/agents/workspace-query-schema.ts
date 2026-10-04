import { z } from 'zod';
import { fileExtensionSchema } from '@/lib/db/files.node';

const folderSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  recent: z.literal(true).optional(),
}).strict().refine((value) => Boolean(value.name) !== Boolean(value.recent), 'Choose a folder name or a recent folder reference.');

const fileReferenceSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  recent: z.literal(true).optional(),
}).strict().refine((value) => Boolean(value.name) !== Boolean(value.recent), 'Choose a file name or a recent file reference.');

export const agentQueryInputSchema = z.object({
  mode: z.enum(['count', 'list', 'retrieve']).describe('count: exact number of files, never facts inside a file; list: complete inventory with exact total and pages of up to 50 file names, including "find all"; retrieve: semantic question about file content or whether a particular file exists, with up to ten evidence files.'),
  field: z.enum(['files', 'extension', 'processing', 'isFavorite']).optional().describe('Count mode only: optional breakdown of file totals.'),
  folder: folderSchema.optional().describe('Use only when the user selects a specific named folder, or an unambiguous recently listed folder.'),
  extensions: z.array(fileExtensionSchema).min(1).max(fileExtensionSchema.options.length).optional().describe('Filter to the requested file type: e.g. MP4 or MOV for videos, MP3 for audio, and image extensions for photos. Keep the same filters on each inventory page.'),
  includeRecentReferences: z.boolean().optional(),
  query: z.string().trim().min(1).max(500).optional().describe('Retrieve mode: semantic question or description. Do not use for an exhaustive inventory.'),
  reference: fileReferenceSchema.optional().describe('Retrieve mode: an unambiguous file already returned in a recent conversation turn; for new names use query.'),
  minSources: z.number().int().min(1).max(10).optional().describe('Retrieve mode: set to 2 or more when comparing events or documents; incomplete source coverage is reported as partial.'),
  cursor: z.string().uuid().optional().describe('List mode only: use only an actual UUID nextCursor returned by this tool; never make up a cursor.'),
  nextPage: z.literal(true).optional().describe('List mode only: the BOOLEAN true, never a string or token. Continue the last inventory in this conversation; do not supply its cursor or filters.'),
}).strict().superRefine((value, context) => {
  if (value.mode === 'retrieve') {
    if (Boolean(value.query) === Boolean(value.reference)) context.addIssue({ code: 'custom', path: ['query'], message: 'Choose a semantic query or a recent file reference.' });
    if (value.field !== undefined || value.cursor || value.nextPage) context.addIssue({ code: 'custom', message: 'Count fields and inventory cursors are not used for retrieval.' });
  } else if (value.mode === 'list') {
    if (value.field !== undefined || value.query !== undefined || value.reference !== undefined || value.minSources !== undefined) context.addIssue({ code: 'custom', message: 'Inventory lists accept file type and folder selectors, not semantic queries or count fields.' });
    if (value.cursor && value.nextPage) context.addIssue({ code: 'custom', path: ['cursor'], message: 'Choose an explicit cursor or the saved next page.' });
  } else if (value.query !== undefined || value.reference !== undefined || value.minSources !== undefined || value.cursor || value.nextPage) context.addIssue({ code: 'custom', message: 'Count accepts a folder, extension filter and optional field breakdown only.' });
});

export type AgentQueryInput = z.input<typeof agentQueryInputSchema>;

/** Repair malformed model argument shapes without inferring intent from message vocabulary. */
export function normalizeAgentQueryArguments(raw: unknown, message: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const input = raw as Record<string, unknown>;
  if (input.mode === 'list') {
    if (input.nextPage !== undefined && input.nextPage !== false) return { mode: 'list', nextPage: true };
    if (typeof input.cursor === 'string' && !z.string().uuid().safeParse(input.cursor).success) return { mode: 'list', nextPage: true };
  }
  if (input.mode !== 'retrieve') return raw;
  const reference = input.reference && typeof input.reference === 'object' && !Array.isArray(input.reference) ? input.reference as Record<string, unknown> : undefined;
  const namedReference = typeof input.reference === 'string' ? input.reference
    : typeof reference?.name === 'string' ? reference.name
      : typeof reference?.recent === 'string' ? reference.recent : undefined;
  const selectedReference = namedReference ? { name: namedReference } : reference?.recent === true ? { recent: true } : input.reference;
  const { reference: _reference, ...rest } = input;
  if (typeof input.query === 'string' && input.query.trim()) return rest;
  return { ...rest, ...(selectedReference ? { reference: selectedReference } : { query: message }) };
}

const recentReferenceSchema = z.object({ resource: z.enum(['folders', 'files']), name: z.string(), extension: fileExtensionSchema.optional(), messageOffset: z.number().int().min(1).max(10) }).strict();
const commonOutput = { status: z.enum(['complete', 'partial']), reason: z.string().optional(), recentReferences: z.array(recentReferenceSchema).optional(), referencesTruncated: z.boolean().optional() };
const retrievedFileSchema = z.object({ name: z.string(), extension: fileExtensionSchema, mimeType: z.string(), sizeBytes: z.number(), processing: z.enum(['pending', 'ready', 'failed']), isFavorite: z.boolean(), isHidden: z.boolean(), createdAt: z.string(), updatedAt: z.string(), folderPath: z.array(z.string()), extractedText: z.string().optional(), caption: z.string().optional(), textTruncated: z.literal(true).optional() }).strict();
const listedFileSchema = z.object({ name: z.string(), extension: fileExtensionSchema, sizeBytes: z.number().int().positive(), processing: z.enum(['pending', 'ready', 'failed']), createdAt: z.string().datetime(), folderPath: z.array(z.string()) }).strict();
export const agentQueryOutputSchema = z.union([
  z.object({ mode: z.literal('count'), field: z.enum(['files', 'extension', 'processing', 'isFavorite']), count: z.number().int().nonnegative().optional(), directCount: z.number().int().nonnegative().optional(), nestedCount: z.number().int().nonnegative().optional(), breakdown: z.record(z.string(), z.number().int().nonnegative()).optional(), ...commonOutput }).strict(),
  z.object({ mode: z.literal('retrieve'), limit: z.literal(10), files: z.array(retrievedFileSchema).max(10), ...commonOutput }).strict(),
  z.object({ mode: z.literal('list'), count: z.number().int().nonnegative().optional(), files: z.array(listedFileSchema).max(50), nextCursor: z.string().uuid().nullable(), ...commonOutput }).strict(),
]);
