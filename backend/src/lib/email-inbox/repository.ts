import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { createCanonicalEmailRepository } from './canonical-repository';

type Database = Pick<typeof db, 'query' | 'collection'> & Partial<Pick<typeof db, 'beginTransaction'>>;

export type ProviderThreadMetadataState = { providerThreadId: string; messages: Array<{ providerMessageId: string; labels: string[]; sentAt: string }> };
export const EMAIL_OVERVIEW_FACETS = ['urgent', 'important', 'filtered', 'favorite'] as const;
export type EmailOverviewFacet = typeof EMAIL_OVERVIEW_FACETS[number];
export type EmailOverviewReadState = 'read' | 'unread';
export type EmailOverviewLegacyFilter = 'all' | 'important' | 'urgent' | 'needs_action' | 'filtered' | 'unread' | 'favorite' | 'trash';
export type EmailOverviewRepositoryQuery = { filter: EmailOverviewLegacyFilter; search?: string; cursor?: string; limit?: number } | { readState: EmailOverviewReadState; facets: EmailOverviewFacet[]; search?: string; cursor?: string; limit?: number };

export function normalizeEmailOverviewFacets(facets: readonly EmailOverviewFacet[]) { const selected = new Set(facets); return EMAIL_OVERVIEW_FACETS.filter((facet) => selected.has(facet)); }
export class EmailRepositoryError extends Error { constructor(readonly reason: 'not_found' | 'forbidden' | 'conflict', message: string = reason) { super(message); } }
function stableKey(kind: string, ...values: string[]) { return `c${createHash('sha256').update([kind, ...values].join('\0')).digest('hex').slice(0, 24)}`; }
export const emailThreadKey = (scopeKey: string, accountKey: string, providerThreadId: string) => stableKey('mail-thread', scopeKey, accountKey, providerThreadId);
export const emailMessageKey = (scopeKey: string, accountKey: string, providerMessageId: string) => stableKey('mail-message', scopeKey, accountKey, providerMessageId);
export const emailSubscriptionDraftKey = (scopeKey: string, messageKey: string) => stableKey('mail-subscription-draft', scopeKey, messageKey);
export function draftKeyFromOutboundMessageId(value?: string) { const match = /^<vorinthex-([a-z0-9]+)@vorinthex\.com>$/.exec(value ?? ''); return match && z.string().cuid().safeParse(match[1]).success ? match[1] : null; }

const emailCursorSchema = z.object({ v: z.literal(2), threadKey: z.string().cuid(), sentAt: z.string().datetime(), providerMessageId: z.string().min(1), key: z.string().cuid() }).strict();
export function encodeEmailCursor(value: z.infer<typeof emailCursorSchema>) { return Buffer.from(JSON.stringify(emailCursorSchema.parse(value))).toString('base64url'); }
export function decodeEmailCursor(value: string, threadKey: string) { const parsed = emailCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))); if (parsed.threadKey !== threadKey) throw new EmailRepositoryError('conflict', 'Email cursor belongs to another thread'); return parsed; }

export function createEmailRepository(database: Database = db) { return createCanonicalEmailRepository(database, (reason, message) => new EmailRepositoryError(reason, message), stableKey); }
export type EmailRepository = ReturnType<typeof createEmailRepository>;
