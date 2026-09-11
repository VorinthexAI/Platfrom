import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { userInboxMessageSchema, userInboxThreadSchema, type UserInboxMessage, type UserInboxThread } from '@/lib/user-inbox/schemas';

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
  threadKey: z.string().cuid(),
  initialMessageKey: z.string().cuid(),
  createdAt: z.string().datetime(),
}).strict();

export type Ticket = z.infer<typeof ticketSchema>;
export type TicketWriteResult =
  | { state: 'created' | 'replay'; ticket: Ticket }
  | { state: 'conflict' }
  | { state: 'forbidden' };

export interface TicketRepository {
  createOrReplay(ticket: Ticket, thread: UserInboxThread, message: UserInboxMessage, teamMembershipKey: string): Promise<TicketWriteResult>;
}

export interface TicketDatabase {
  query(query: string, bindVars?: Record<string, unknown>): Promise<{ next(): Promise<unknown>; all?(): Promise<unknown[]> }>;
}

type TicketTransactionRunner = <T>(collections: { read: string[]; write: string[] }, operation: (database: TicketDatabase) => Promise<T>) => Promise<T>;

export function createTicketRepository(database: TicketDatabase = db, transact: TicketTransactionRunner = withTransaction as TicketTransactionRunner): TicketRepository {
  return {
    async createOrReplay(ticket, thread, message, teamMembershipKey) {
      const value = ticketSchema.parse(ticket);
      const threadValue = userInboxThreadSchema.parse(thread);
      const messageValue = userInboxMessageSchema.parse(message);
      teamMembershipKey = z.string().cuid().parse(teamMembershipKey);
      return transact({ read: ['users', 'userTeams', 'scopes', 'scopeMembers'], write: [TICKETS_COLLECTION, 'userInboxThreads', 'userInboxMessages'] }, async (transaction) => {
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
           LET inboxThread = created ? (INSERT @thread INTO userInboxThreads RETURN NEW) : []
           LET inboxMessage = created ? (INSERT @message INTO userInboxMessages RETURN NEW) : []
           RETURN { ticket: NEW, previousHash: OLD == null ? null : OLD.requestHash }
        `, {
          '@collection': TICKETS_COLLECTION,
          teamMembershipKey,
          teamKey: value.teamKey,
          scopeKey: value.scopeKey,
          userKey: value.userKey,
          idempotencyKey: value.idempotencyKey,
           ticket: toArangoDoc(value),
           thread: toArangoDoc(threadValue),
           message: toArangoDoc(messageValue),
        });
        const row = await cursor.next() as { ticket: Record<string, unknown>; previousHash: string | null } | undefined;
        if (!row) return { state: 'forbidden' };
        const stored = ticketSchema.parse(withArangoKey(row.ticket));
        if (row.previousHash !== null && row.previousHash !== value.requestHash) return { state: 'conflict' };
        return { state: row.previousHash === null ? 'created' : 'replay', ticket: stored };
      });
    },
  };
}

let defaultRepository: TicketRepository | undefined;
export function getDefaultTicketRepository() {
  return defaultRepository ??= createTicketRepository();
}
