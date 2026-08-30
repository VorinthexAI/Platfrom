import { z } from 'zod';
import type { ActionDefinition } from './types';

export const MAX_FILE_ACTION_BYTES = 25 * 1024 * 1024;
export const MAX_FILE_ACTION_TEXT_CHARACTERS = 10_000_000;

const fileBytesSchema = z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_FILE_ACTION_BYTES, 'File bytes exceed the supported size.');

export const fileInputSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('document'),
    storageKey: z.string().trim().min(1).max(1_024),
    filename: z.string().trim().min(1).max(255),
    mimeType: z.literal('application/pdf'),
    bytes: fileBytesSchema,
  }).strict(),
  z.object({
    operation: z.literal('scan'),
    storageKey: z.string().trim().min(1).max(1_024),
    mimeType: z.enum(['image/jpeg', 'image/png']),
    bytes: fileBytesSchema,
  }).strict(),
]);

export const fileOutputSchema = z.object({
  text: z.string().max(MAX_FILE_ACTION_TEXT_CHARACTERS),
  metadata: z.record(z.unknown()).optional(),
}).strict();

export type FileInput = z.infer<typeof fileInputSchema>;
export type FileOutput = z.infer<typeof fileOutputSchema>;

export const fileAction: ActionDefinition = {
  id: 'file',
  modelPolicy: 'none',
  models: [],
};
