import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';

export const TICKETS_COLLECTION = 'tickets';
export const ticketSchema = z.object({
  key: z.string().cuid(),
  teamKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  userKey: z.string().cuid(),
  message: z.string().trim().min(1).max(8_000),
  embedding: currentEmbeddingSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  type: z.enum(['issue', 'feedback']).default('issue'),
  threadKey: z.string().cuid().optional(),
  initialMessageKey: z.string().cuid().optional(),
  createdAt: z.string().datetime(),
}).strict();
export const ticketListInputSchema = z.object({
  cursor: z.string().cuid().optional(),
  limit: z.number().int().min(1).max(50).default(10),
  kind: ticketSchema.shape.type.optional(),
}).strict();

export type Ticket = z.infer<typeof ticketSchema>;
export type TicketWriteResult =
  | { state: 'created' | 'replay'; ticket: Ticket }
  | { state: 'conflict' }
  | { state: 'forbidden' };

export class InvalidTicketCursorError extends Error {
  constructor() { super('Ticket cursor is invalid.'); }
}

export interface TicketRepository {
  createOrReplay(ticket: Ticket, teamMembershipKey: string): Promise<TicketWriteResult>;
  list(owner: { teamKey: string; scopeKey: string; userKey: string }, input: z.output<typeof ticketListInputSchema>): Promise<{ items: Ticket[]; nextCursor: string | null }>;
  get(owner: { teamKey: string; scopeKey: string; userKey: string }, ticketKey: string): Promise<Ticket | null>;
  search(owner: { teamKey: string; scopeKey: string; userKey: string }, embedding: number[], query: string, input: { createdFrom?: string; createdTo?: string; limit: number; kind?: 'issue' | 'feedback' }): Promise<Array<Ticket & { score: number }>>;
}

export interface TicketDatabase {
  query(query: string, bindVars?: Record<string, unknown>): Promise<{ next(): Promise<unknown>; all?(): Promise<unknown[]> }>;
}

type TicketTransactionRunner = <T>(collections: { read: string[]; write: string[] }, operation: (database: TicketDatabase) => Promise<T>) => Promise<T>;

export function createTicketRepository(database: TicketDatabase = db, transact: TicketTransactionRunner = withTransaction as TicketTransactionRunner): TicketRepository {
  return {
    async createOrReplay(ticket, teamMembershipKey) {
      const value = ticketSchema.parse(ticket);
      teamMembershipKey = z.string().cuid().parse(teamMembershipKey);
      return transact({ read: ['users', 'userTeams', 'scopes', 'scopeMembers'], write: [TICKETS_COLLECTION] }, async (transaction) => {
        const cursor = await transaction.query(`
          LET user = DOCUMENT(users, @userKey)
          LET membership = DOCUMENT(userTeams, @teamMembershipKey)
          LET scope = DOCUMENT(scopes, @scopeKey)
          LET scopeMember = FIRST(
            FOR member IN scopeMembers
              FILTER member.scopeKey == @scopeKey
                && member.userTeamKey == @teamMembershipKey
                && member.status == "active"
              LIMIT 1
              RETURN member
          )
          FILTER user != null
            && membership != null
            && membership.teamKey == @teamKey
            && membership.userId == @userKey
            && membership.status == "active"
            && scope != null
            && scope.teamKey == @teamKey
            && (membership.teamRole IN ["owner", "admin"] || scopeMember != null)
          UPSERT {
            teamKey: @teamKey,
            userKey: @userKey,
            idempotencyKey: @idempotencyKey
          }
            INSERT @ticket
            UPDATE {}
            IN @@collection
           LET created = OLD == null
           RETURN { ticket: NEW, previousHash: OLD == null ? null : OLD.requestHash }
        `, {
          '@collection': TICKETS_COLLECTION,
          teamMembershipKey,
          teamKey: value.teamKey,
          scopeKey: value.scopeKey,
          userKey: value.userKey,
          idempotencyKey: value.idempotencyKey,
          ticket: toArangoDoc(value),
        });
        const row = await cursor.next() as { ticket: Record<string, unknown>; previousHash: string | null } | undefined;
        if (!row) return { state: 'forbidden' };
        const stored = ticketSchema.parse(withArangoKey(row.ticket));
        if (row.previousHash !== null && row.previousHash !== value.requestHash) return { state: 'conflict' };
        return { state: row.previousHash === null ? 'created' : 'replay', ticket: stored };
      });
    },
    async list(owner, rawInput) {
      const input = ticketListInputSchema.parse(rawInput);
      const cursor = await database.query(`
        LET cursorItem = @cursor == null ? null : FIRST(FOR item IN @@collection FILTER item._key == @cursor && item.teamKey == @teamKey && item.scopeKey == @scopeKey && item.userKey == @userKey LIMIT 1 RETURN item)
        FILTER @cursor == null || cursorItem != null
        LET items = (FOR item IN @@collection
          FILTER item.teamKey == @teamKey && item.scopeKey == @scopeKey && item.userKey == @userKey
          FILTER @kind == null || item.type == @kind
          FILTER cursorItem == null || item.createdAt < cursorItem.createdAt || (item.createdAt == cursorItem.createdAt && item._key < cursorItem._key)
          SORT item.createdAt DESC, item._key DESC
          LIMIT @pageSize
          RETURN item)
        RETURN { items }
      `, { '@collection': TICKETS_COLLECTION, ...owner, cursor: input.cursor ?? null, kind: input.kind ?? null, pageSize: input.limit + 1 });
      const row = await cursor.next() as { items: Record<string, unknown>[] } | undefined;
      if (input.cursor && !row) throw new InvalidTicketCursorError();
      const parsed = (row?.items ?? []).map((item) => ticketSchema.parse(withArangoKey(item)));
      return { items: parsed.slice(0, input.limit), nextCursor: parsed.length > input.limit ? parsed[input.limit - 1]!.key : null };
    },
    async get(owner, ticketKey) {
      const cursor = await database.query('FOR item IN @@collection FILTER item._key == @ticketKey && item.teamKey == @teamKey && item.scopeKey == @scopeKey && item.userKey == @userKey LIMIT 1 RETURN item', { '@collection': TICKETS_COLLECTION, ...owner, ticketKey: z.string().cuid().parse(ticketKey) });
      const row = await cursor.next();
      return row ? ticketSchema.parse(withArangoKey(row as Record<string, unknown>)) : null;
    },
    async search(owner, embedding, query, input) {
      const cursor = await database.query(`
        FOR item IN @@collection
          FILTER item.teamKey == @teamKey && item.scopeKey == @scopeKey && item.userKey == @userKey
          FILTER @kind == null || item.type == @kind
          FILTER @createdFrom == null || item.createdAt >= @createdFrom
          FILTER @createdTo == null || item.createdAt <= @createdTo
          LET direct = CONTAINS(LOWER(item.message), @query)
          LET score = COSINE_SIMILARITY(item.embedding, @embedding)
          FILTER direct || IS_NUMBER(score) && score >= -1
          SORT direct DESC, score DESC, item.createdAt DESC, item._key DESC
          LIMIT @limit
          RETURN { item, score: direct ? 1 : score }
      `, { '@collection': TICKETS_COLLECTION, ...owner, embedding: currentEmbeddingSchema.parse(embedding), query: query.trim().toLowerCase(), kind: input.kind ?? null, createdFrom: input.createdFrom ?? null, createdTo: input.createdTo ?? null, limit: input.limit });
      const rows = await (cursor.all?.() ?? Promise.resolve([])) as Array<{ item: Record<string, unknown>; score: number }>;
      return rows.map((row) => ({ ...ticketSchema.parse(withArangoKey(row.item)), score: row.score }));
    },
  };
}

let defaultRepository: TicketRepository | undefined;
export function getDefaultTicketRepository() {
  return defaultRepository ??= createTicketRepository();
}
