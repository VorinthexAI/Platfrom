import { z } from 'zod';
import { fileExtensionSchema } from '@/lib/db/files.node';

const resourceSchema = z.enum(['workspace', 'folders', 'files']);
const parentSchema = z.object({ resource: z.enum(['folders']), name: z.string().trim().min(1).max(160).optional(), recent: z.boolean().optional() }).strict().refine((value) => !(value.name && value.recent), 'Choose a name or a recent reference, not both.');
const requestSchema = z.object({ operation: z.enum(['discover', 'search', 'list', 'count', 'sum', 'read']), resource: resourceSchema, query: z.string().trim().min(1).max(500).optional(), parent: parentSchema.optional(), field: z.enum(['sizeBytes']).optional(), extensions: z.array(fileExtensionSchema).min(1).max(fileExtensionSchema.options.length).optional(), limit: z.number().int().min(1).max(50).default(10) }).strict().superRefine((value, ctx) => {
  if (value.resource === 'workspace' ? !['search', 'discover'].includes(value.operation) : value.operation === 'discover') ctx.addIssue({ code: 'custom', message: 'Workspace search and discovery require the workspace resource; other operations require a specific resource.' });
  if (value.resource === 'workspace' && (!value.query || value.parent || value.field)) ctx.addIssue({ code: 'custom', message: 'Workspace search requires a query without filters.' });
  if (value.resource === 'folders' && value.extensions) ctx.addIssue({ code: 'custom', path: ['extensions'], message: 'Extension filters apply only to files.' });
});
export const agentQueryInputSchema = z.object({ requests: z.array(requestSchema).min(1).max(4) }).strict();
export type AgentQueryInput = z.input<typeof agentQueryInputSchema>;
