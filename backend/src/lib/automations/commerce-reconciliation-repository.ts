import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { commerceReconciliationWindowSchema, latestClosedCommerceDay, type CommerceReconciliationWindow } from './commerce-reconciliation';

export const COMMERCE_RECONCILIATION_RUNS_COLLECTION = 'commerceReconciliationRuns';
export const commerceReconciliationRunSchema = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  status: z.enum(['pending', 'completed']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
}).strict();
export type CommerceReconciliationRun = z.infer<typeof commerceReconciliationRunSchema>;
type Cursor = { next(): Promise<unknown>; all(): Promise<unknown[]> };
export interface CommerceReconciliationDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<Cursor> }
export interface CommerceReconciliationRepository {
  prepareLatestMissingDay(now: Date): Promise<CommerceReconciliationWindow | null>;
  ensurePending(window: CommerceReconciliationWindow, at: string): Promise<CommerceReconciliationRun>;
  complete(window: CommerceReconciliationWindow, completedAt: string): Promise<void>;
}

export const commerceReconciliationRunId = (windowStart: string) => createHash('sha256').update(`commerce-reconciliation-run\0${windowStart}`).digest('hex');
const parseRun = (value: unknown) => commerceReconciliationRunSchema.parse(withArangoKey(value as Record<string, unknown>));

export function createCommerceReconciliationRepository(database: CommerceReconciliationDatabase = db as unknown as CommerceReconciliationDatabase): CommerceReconciliationRepository {
  const ensurePending = async (rawWindow: CommerceReconciliationWindow, at: string) => {
    const window = commerceReconciliationWindowSchema.parse(rawWindow);
    const timestamp = z.string().datetime().parse(at);
    const document = commerceReconciliationRunSchema.parse({ key: commerceReconciliationRunId(window.start), windowStart: window.start, windowEnd: window.end, status: 'pending', createdAt: timestamp, updatedAt: timestamp, completedAt: null });
    const cursor = await database.query('UPSERT { windowStart: @windowStart } INSERT @document UPDATE {} IN @@runs RETURN NEW', { '@runs': COMMERCE_RECONCILIATION_RUNS_COLLECTION, windowStart: window.start, document: toArangoDoc(document) });
    return parseRun(await cursor.next());
  };
  return {
    ensurePending,
    async prepareLatestMissingDay(now) {
      const window = latestClosedCommerceDay(now);
      const cursor = await database.query('FOR run IN @@runs FILTER run.windowStart == @windowStart && run.status == "completed" LIMIT 1 RETURN true', { '@runs': COMMERCE_RECONCILIATION_RUNS_COLLECTION, windowStart: window.start });
      if (await cursor.next()) return null;
      await ensurePending(window, now.toISOString());
      return window;
    },
    async complete(rawWindow, completedAt) {
      const window = commerceReconciliationWindowSchema.parse(rawWindow);
      const at = z.string().datetime().parse(completedAt);
      await database.query('FOR run IN @@runs FILTER run.windowStart == @windowStart && run.windowEnd == @windowEnd && run.status == "pending" UPDATE run WITH { status: "completed", completedAt: @completedAt, updatedAt: @completedAt } IN @@runs', { '@runs': COMMERCE_RECONCILIATION_RUNS_COLLECTION, windowStart: window.start, windowEnd: window.end, completedAt: at });
    },
  };
}

export const getDefaultCommerceReconciliationRepository = () => createCommerceReconciliationRepository();
