import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';

export const TICKETS_COLLECTION = 'tickets';
export const TICKET_VOTES_COLLECTION = 'ticketVotes';

export const ticketVoteValueSchema = z.enum(['up', 'down']);

export const ticketSchema = z.object({
  key: z.string().cuid(),
  organizationKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  userKey: z.string().cuid(),
  message: z.string().trim().min(1).max(8_000),
  embedding: currentEmbeddingSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  type: z.enum(['issue', 'feedback']).default('issue'),
  upvotes: z.number().int().nonnegative().optional(),
  downvotes: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime(),
}).strict();

export type Ticket = z.infer<typeof ticketSchema>;
export type TicketWriteResult =
  | { state: 'created' | 'replay'; ticket: Ticket }
  | { state: 'conflict' }
  | { state: 'forbidden' };
export type TicketListResult = { state: 'ok'; tickets: Array<{ ticket: Ticket; viewerVote: z.infer<typeof ticketVoteValueSchema> | null }>; nextCursor: string | null } | { state: 'forbidden' };
export type TicketVoteResult = { state: 'ok'; ticket: Ticket; viewerVote: z.infer<typeof ticketVoteValueSchema> | null } | { state: 'not_found' } | { state: 'forbidden' };

export interface TicketRepository {
  createOrReplay(ticket: Ticket, membershipKey: string): Promise<TicketWriteResult>;
  listFeedback(input: { organizationKey: string; scopeKey: string; userKey: string; membershipKey: string; cursor?: string; limit: number }): Promise<TicketListResult>;
  setFeedbackVote(input: { organizationKey: string; scopeKey: string; userKey: string; membershipKey: string; ticketKey: string; vote: z.infer<typeof ticketVoteValueSchema> | null; voteKey: string; now: string }): Promise<TicketVoteResult>;
}

export interface TicketDatabase {
  query(query: string, bindVars?: Record<string, unknown>): Promise<{ next(): Promise<unknown>; all?(): Promise<unknown[]> }>;
}

type TicketTransactionRunner = <T>(collections: { read: string[]; write: string[] }, operation: (database: TicketDatabase) => Promise<T>) => Promise<T>;

export function createTicketRepository(database: TicketDatabase = db, transact: TicketTransactionRunner = withTransaction as TicketTransactionRunner): TicketRepository {
  return {
    async createOrReplay(ticket, membershipKey) {
      const value = ticketSchema.parse(ticket);
      membershipKey = z.string().cuid().parse(membershipKey);
      return transact({ read: ['users', 'userOrganizations', 'scopes', 'scopeMembers'], write: [TICKETS_COLLECTION] }, async (transaction) => {
        const cursor = await transaction.query(`
          LET user = DOCUMENT(users, @userKey)
          LET membership = DOCUMENT(userOrganizations, @membershipKey)
          LET scope = DOCUMENT(scopes, @scopeKey)
          LET scopeMember = FIRST(
            FOR member IN scopeMembers
              FILTER member.scopeKey == @scopeKey
                && member.userOrganizationKey == @membershipKey
                && member.status == "active"
              LIMIT 1
              RETURN member
          )
          FILTER user != null
            && membership != null
            && membership.organizationId == @organizationKey
            && membership.userId == @userKey
            && membership.status == "active"
            && scope != null
            && scope.organizationKey == @organizationKey
            && (membership.orgRole IN ["owner", "admin"] || scopeMember != null)
          UPSERT {
            organizationKey: @organizationKey,
            userKey: @userKey,
            idempotencyKey: @idempotencyKey
          }
            INSERT @ticket
            UPDATE {}
            IN @@collection
          RETURN { ticket: NEW, previousHash: OLD == null ? null : OLD.requestHash }
        `, {
          '@collection': TICKETS_COLLECTION,
          membershipKey,
          organizationKey: value.organizationKey,
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
    async listFeedback(input) {
      return transact({ read: ['users', 'userOrganizations', 'scopes', 'scopeMembers', TICKETS_COLLECTION, TICKET_VOTES_COLLECTION], write: [] }, async (transaction) => {
        const cursor = await transaction.query(`
          LET user = DOCUMENT(users, @userKey)
          LET membership = DOCUMENT(userOrganizations, @membershipKey)
          LET scope = DOCUMENT(scopes, @scopeKey)
          LET scopeMember = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN member)
          LET authorized = user != null && membership != null && membership.organizationId == @organizationKey && membership.userId == @userKey && membership.status == "active" && scope != null && scope.organizationKey == @organizationKey && (membership.orgRole IN ["owner", "admin"] || scopeMember != null)
          LET cursorTicket = @cursor == null ? null : FIRST(FOR item IN @@tickets FILTER item._key == @cursor && item.organizationKey == @organizationKey && item.scopeKey == @scopeKey && item.type == "feedback" LIMIT 1 RETURN item)
          LET rows = authorized ? (
            FOR ticket IN @@tickets
              FILTER ticket.organizationKey == @organizationKey && ticket.scopeKey == @scopeKey && ticket.type == "feedback"
              FILTER cursorTicket == null || ticket.createdAt < cursorTicket.createdAt || (ticket.createdAt == cursorTicket.createdAt && ticket._key < cursorTicket._key)
              SORT ticket.createdAt DESC, ticket._key DESC
              LIMIT @pageSize
              LET vote = FIRST(FOR item IN @@votes FILTER item.ticketKey == ticket._key && item.userKey == @userKey LIMIT 1 RETURN item.vote)
              RETURN { ticket, viewerVote: vote }
          ) : null
          RETURN { authorized, rows }
        `, { '@tickets': TICKETS_COLLECTION, '@votes': TICKET_VOTES_COLLECTION, ...input, cursor: input.cursor ?? null, pageSize: input.limit + 1 });
        const result = await cursor.next() as { authorized: boolean; rows: Array<{ ticket: Record<string, unknown>; viewerVote: unknown }> } | undefined;
        if (!result?.authorized) return { state: 'forbidden' };
        const hasMore = result.rows.length > input.limit;
        const rows = result.rows.slice(0, input.limit).map(({ ticket, viewerVote }) => ({ ticket: ticketSchema.parse(withArangoKey(ticket)), viewerVote: viewerVote == null ? null : ticketVoteValueSchema.parse(viewerVote) }));
        return { state: 'ok', tickets: rows, nextCursor: hasMore ? rows.at(-1)?.ticket.key ?? null : null };
      });
    },
    async setFeedbackVote(input) {
      return transact({ read: ['users', 'userOrganizations', 'scopes', 'scopeMembers'], write: [TICKETS_COLLECTION, TICKET_VOTES_COLLECTION] }, async (transaction) => {
        const authorizationCursor = await transaction.query(`
          LET user = DOCUMENT(users, @userKey)
          LET membership = DOCUMENT(userOrganizations, @membershipKey)
          LET scope = DOCUMENT(scopes, @scopeKey)
          LET scopeMember = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == @membershipKey && member.status == "active" LIMIT 1 RETURN member)
          LET authorized = user != null && membership != null && membership.organizationId == @organizationKey && membership.userId == @userKey && membership.status == "active" && scope != null && scope.organizationKey == @organizationKey && (membership.orgRole IN ["owner", "admin"] || scopeMember != null)
          LET ticket = DOCUMENT(@@tickets, @ticketKey)
          LET selected = authorized && ticket != null && ticket.organizationKey == @organizationKey && ticket.scopeKey == @scopeKey && ticket.type == "feedback" ? ticket : null
          RETURN { authorized, selected: selected != null }
        `, { '@tickets': TICKETS_COLLECTION, ...input });
        const authorization = await authorizationCursor.next() as { authorized: boolean; selected: boolean } | undefined;
        if (!authorization?.authorized) return { state: 'forbidden' };
        if (!authorization.selected) return { state: 'not_found' };

        if (input.vote === null) {
          await transaction.query('FOR item IN @@votes FILTER item.ticketKey == @ticketKey && item.userKey == @userKey REMOVE item IN @@votes', { '@votes': TICKET_VOTES_COLLECTION, ticketKey: input.ticketKey, userKey: input.userKey });
        } else {
          await transaction.query(`
            UPSERT { ticketKey: @ticketKey, userKey: @userKey }
              INSERT { _key: @voteKey, organizationKey: @organizationKey, scopeKey: @scopeKey, ticketKey: @ticketKey, userKey: @userKey, vote: @vote, createdAt: @now, updatedAt: @now }
              UPDATE { vote: @vote, updatedAt: @now }
              IN @@votes
          `, { '@votes': TICKET_VOTES_COLLECTION, ...input });
        }
        const countsCursor = await transaction.query(`
          RETURN FIRST(
            FOR item IN @@votes
              FILTER item.ticketKey == @ticketKey
              COLLECT AGGREGATE upvotes = SUM(item.vote == "up" ? 1 : 0), downvotes = SUM(item.vote == "down" ? 1 : 0)
              RETURN { upvotes, downvotes }
          )
        `, { '@votes': TICKET_VOTES_COLLECTION, ticketKey: input.ticketKey });
        const counts = await countsCursor.next() as { upvotes: number; downvotes: number } | null | undefined;
        const updateCursor = await transaction.query(`
          UPDATE @ticketKey WITH { upvotes: @upvotes, downvotes: @downvotes } IN @@tickets
          RETURN NEW
        `, { '@tickets': TICKETS_COLLECTION, ticketKey: input.ticketKey, upvotes: counts?.upvotes ?? 0, downvotes: counts?.downvotes ?? 0 });
        const updated = await updateCursor.next() as Record<string, unknown> | undefined;
        if (!updated) return { state: 'not_found' };
        return { state: 'ok', ticket: ticketSchema.parse(withArangoKey(updated)), viewerVote: input.vote };
      });
    },
  };
}

let defaultRepository: TicketRepository | undefined;
export function getDefaultTicketRepository() {
  return defaultRepository ??= createTicketRepository();
}
