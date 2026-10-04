import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { withArangoKey } from '@/lib/db/base';
import { fileExtensionSchema, fileProcessingSchema } from '@/lib/db/files.node';
import { redisConnection } from '@/lib/redis';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contextUserKey } from '@/lib/ai/tools/tool-context';

export const INVENTORY_PAGE_SIZE = 50;
const CURSOR_TTL_SECONDS = 60 * 60;
const cursorStateSchema = z.object({
  userKey: z.string().cuid(), scopeKey: z.string().cuid(),
  folderKey: z.string().cuid().nullable(), extensions: z.array(fileExtensionSchema).nullable(),
  snapshotAt: z.string().datetime(), afterCreatedAt: z.string().datetime(), afterKey: z.string().cuid(),
}).strict();
type CursorState = z.infer<typeof cursorStateSchema>;

const inventoryRowSchema = z.object({
  key: z.string().cuid(), name: z.string().trim().min(1), extension: fileExtensionSchema,
  sizeBytes: z.number().int().positive(), processing: fileProcessingSchema,
  createdAt: z.string().datetime(), folderKey: z.string().cuid().optional(),
}).strip();

const ownedInventory = `
  FOR file IN files
    FILTER file.userKey == @userKey && file.scopeKey == @scopeKey && file.isHidden != true
    FILTER file.createdAt <= @snapshotAt
    FILTER @folderKeys == null || file.folderKey IN @folderKeys
    FILTER @extensions == null || file.extension IN @extensions`;

const cursorKey = (token: string) => `agent-query:inventory:cursor:${token}`;
const conversationKey = (userKey: string, chatKey: string) => `agent-query:inventory:conversation:${userKey}:${chatKey}`;

export async function listWorkspaceInventory(input: {
  context: ToolContext;
  folderKey?: string;
  folderKeys?: string[];
  extensions?: z.infer<typeof fileExtensionSchema>[];
  cursor?: string;
  nextPage?: true;
  conversationKey?: string;
  folderExists: (key: string) => boolean;
  descendants: (key: string) => string[];
  folderPath: (key: unknown) => string[];
}) {
  const userKey = contextUserKey(input.context);
  const scopeKey = input.context.runtimeScopeKey;
  const sessionKey = input.conversationKey ? conversationKey(userKey, input.conversationKey) : undefined;
  const token = input.nextPage && sessionKey ? await redisConnection.get(sessionKey) : input.cursor;
  const unavailable = (reason: string) => ({ count: undefined, files: [], nextCursor: null, status: 'partial' as const, reason });
  if (input.nextPage && !token) return unavailable('There is no saved next page for this conversation. Start a new listing.');

  let state: CursorState | undefined;
  if (token) {
    const stored = await redisConnection.get(cursorKey(token));
    if (!stored) return unavailable('The page cursor has expired. Start a new listing.');
    const parsed = cursorStateSchema.safeParse(JSON.parse(stored));
    if (!parsed.success || parsed.data.userKey !== userKey || parsed.data.scopeKey !== scopeKey) return unavailable('The page cursor is not available in this scope.');
    state = parsed.data;
    if (input.folderKey && input.folderKey !== state.folderKey) return unavailable('The page cursor belongs to a different folder.');
    if (input.extensions && JSON.stringify([...input.extensions].sort()) !== JSON.stringify([...(state.extensions ?? [])].sort())) return unavailable('The page cursor belongs to different file types.');
  }

  const folderKey = state?.folderKey ?? input.folderKey ?? null;
  if (folderKey && !input.folderExists(folderKey)) return unavailable('The listed folder is no longer available in this scope.');
  const folderKeys = folderKey ? input.descendants(folderKey) : undefined;
  const extensions = state?.extensions ?? input.extensions ?? null;
  const snapshotAt = state?.snapshotAt ?? new Date().toISOString();
  const bind = { userKey, scopeKey, snapshotAt, folderKeys: folderKeys ?? null, extensions };
  const countCursor = await db.query(`${ownedInventory} COLLECT WITH COUNT INTO total RETURN total`, bind);
  const count = z.number().int().nonnegative().safe().parse(await countCursor.next() ?? 0);
  const page = await db.query(`${ownedInventory}
    FILTER @afterCreatedAt == null || file.createdAt < @afterCreatedAt || (file.createdAt == @afterCreatedAt && file._key > @afterKey)
    SORT file.createdAt DESC, file._key ASC
    LIMIT @limit
    RETURN KEEP(file, "_key", "name", "extension", "sizeBytes", "processing", "createdAt", "folderKey")`, {
    ...bind, afterCreatedAt: state?.afterCreatedAt ?? null, afterKey: state?.afterKey ?? null, limit: INVENTORY_PAGE_SIZE + 1,
  });
  const rows = (await page.all() as Record<string, unknown>[]).map((row) => inventoryRowSchema.parse(withArangoKey(row)));
  const selected = rows.slice(0, INVENTORY_PAGE_SIZE);
  const hasMore = rows.length > INVENTORY_PAGE_SIZE;
  let nextCursor: string | null = null;
  if (hasMore) {
    const last = selected.at(-1)!;
    nextCursor = randomUUID();
    await redisConnection.set(cursorKey(nextCursor), JSON.stringify(cursorStateSchema.parse({ userKey, scopeKey, folderKey, extensions, snapshotAt, afterCreatedAt: last.createdAt, afterKey: last.key })), 'EX', CURSOR_TTL_SECONDS);
    if (sessionKey) await redisConnection.set(sessionKey, nextCursor, 'EX', CURSOR_TTL_SECONDS);
  } else if (sessionKey) await redisConnection.del(sessionKey);

  return {
    count, files: selected.map(({ key, folderKey: parent, ...file }) => ({ key, ...file, folderPath: input.folderPath(parent) })),
    nextCursor, status: hasMore ? 'partial' as const : 'complete' as const,
    ...(hasMore ? { reason: `Showing ${selected.length} of ${count} files. Request the next page to continue.` } : {}),
  };
}
