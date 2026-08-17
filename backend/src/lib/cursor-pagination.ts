import { z } from 'zod';

export const cursorPaginationInputShape = {
  cursor: z.string().trim().min(1).max(2_000).optional(),
  limit: z.number().int().min(1).max(100).default(100),
};

export type CursorPage<T> = { items: T[]; nextCursor: string | null };

export function encodeCursor(value: unknown) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<T>(cursor: string | undefined, schema: z.ZodType<T>): T | undefined {
  if (!cursor) return undefined;
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'Cursor is invalid.' }]);
  }
}

export function cursorPage<T>(rows: T[], limit: number, cursorFor: (item: T) => string): CursorPage<T> {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit && items.length ? cursorFor(items.at(-1)!) : null };
}
