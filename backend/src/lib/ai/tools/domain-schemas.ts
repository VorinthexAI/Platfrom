import { z } from 'zod';
import { contentToolInputSchemas } from './domain-content-schemas';

export const domainToolInputSchemas = {
  'email.thread.list': z.object({ filter: z.enum(['all', 'important', 'urgent', 'needs_action', 'filtered', 'unread', 'favorite']).default('all'), search: z.string().trim().min(1).max(200).optional() }).strict(),
  'email.thread.read': z.object({ threadKey: z.string().cuid() }).strict(),
  'email.reply.draft': z.object({ threadKey: z.string().cuid(), tone: z.enum(['concise', 'warm', 'formal', 'direct']).default('concise'), instruction: z.string().trim().min(1).max(1000).optional(), profileKey: z.string().cuid().optional() }).strict(),
  ...contentToolInputSchemas,
} as const;

export type DomainActionSlug = keyof typeof domainToolInputSchemas;
export const DOMAIN_ACTION_SLUGS = Object.keys(domainToolInputSchemas) as DomainActionSlug[];
export const isDomainActionSlug = (value: string): value is DomainActionSlug => value in domainToolInputSchemas;

export const domainToolResultSchema = z.object({
  action: z.string().min(1),
  status: z.enum(['completed', 'preview']),
  data: z.unknown(),
}).strict();
export type DomainToolResult = z.infer<typeof domainToolResultSchema>;
