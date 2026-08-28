import { z } from 'zod';

export const BOOK_EXTENSIONS_COLLECTION = 'bookExtensions';
export const bookExtensionStatusSchema = z.enum(['pending', 'generating', 'complete']);
export const bookExtensionSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  bookKey: z.string().cuid(),
  userKey: z.string().cuid(),
  requestKey: z.string().trim().min(1).max(200),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  titles: z.array(z.string().trim().min(1)).min(1).max(5),
  baseChapterCount: z.number().int().nonnegative(),
  targetChapterCount: z.number().int().positive(),
  status: bookExtensionStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BookExtension = z.infer<typeof bookExtensionSchema>;
