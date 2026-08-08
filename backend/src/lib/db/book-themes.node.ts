import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const BOOK_THEMES_COLLECTION = 'bookThemes';
export const bookThemeSchema = z.object({ key: z.string().cuid(), scopeKey: z.string().cuid(), bookKey: z.string().cuid(), name: z.string().trim().min(1), description: z.string().trim().min(1), position: z.number().int().positive(), embedding: currentEmbeddingSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime() });
export type BookTheme = z.infer<typeof bookThemeSchema>;
export const bookThemesEmbeddingFields = ['name', 'description'] as const;
const helpers = createNodeHelpers(BOOK_THEMES_COLLECTION, bookThemeSchema, bookThemesEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertBookTheme = helpers.insert;
export const getBookThemeById = helpers.getById;
export const updateBookTheme = helpers.updateById;
export const deleteBookTheme = helpers.deleteById;
export const upsertBookThemeByKey = helpers.upsertByKey;
export const getAllBookThemesChunked = helpers.getAllChunked;
export const listBookThemesPage = helpers.listPage;
