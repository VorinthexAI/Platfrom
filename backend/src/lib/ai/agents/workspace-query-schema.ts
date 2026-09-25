import { z } from 'zod';

const resourceSchema = z.enum(['workspace', 'folders', 'documents', 'files', 'collections', 'images', 'inboxes', 'email-messages', 'email-drafts', 'email-tones', 'email-reply-notes', 'places', 'trips', 'trip-guides', 'place-references', 'books', 'memories', 'highlights', 'subjects', 'tags', 'tickets', 'notifications']);
const parentSchema = z.object({ resource: z.enum(['collections', 'folders', 'inboxes', 'trips', 'places']), name: z.string().trim().min(1).max(160).optional(), recent: z.boolean().optional() }).strict().refine((value) => !(value.name && value.recent), 'Choose a name or a recent reference, not both.');
const requestSchema = z.object({ operation: z.enum(['discover', 'search', 'list', 'count', 'sum', 'read']), resource: resourceSchema, query: z.string().trim().min(1).max(500).optional(), parent: parentSchema.optional(), field: z.enum(['sizeBytes', 'estimatedMinutes', 'chapterCount']).optional(), limit: z.number().int().min(1).max(50).default(10) }).strict().superRefine((value, ctx) => {
  if (value.resource === 'workspace' ? !['search', 'discover'].includes(value.operation) : value.operation === 'discover') ctx.addIssue({ code: 'custom', message: 'Workspace search and discovery require the workspace resource; other operations require a specific resource.' });
  if (value.resource === 'workspace' && (!value.query || value.parent || value.field)) ctx.addIssue({ code: 'custom', message: 'Workspace search requires a query without filters.' });
});
export const agentQueryInputSchema = z.object({ requests: z.array(requestSchema).min(1).max(4) }).strict();
export type AgentQueryInput = z.input<typeof agentQueryInputSchema>;
