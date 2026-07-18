import { z } from 'zod';
import { userOrganizationRoleSchema } from '@/lib/db/user-organization.node';

const referenceSchema = z.string().trim().min(1).max(320);
const referencesSchema = z.array(referenceSchema).min(1).max(100);
const reasonSchema = z.string().trim().min(1).max(500).optional();
const assignableOrganizationRoleSchema = userOrganizationRoleSchema.exclude(['member']);

export const domainToolInputSchemas = {
  'organization.member.list': z.object({ role: userOrganizationRoleSchema.optional(), status: z.enum(['active', 'inactive', 'suspended']).optional(), name: z.string().trim().min(1).optional(), email: z.string().trim().min(1).optional(), alias: z.string().trim().min(1).optional(), limit: z.number().int().min(1).max(100).default(50), cursor: z.string().optional(), sort: z.enum(['name', 'email', 'role', 'status']).default('name') }).strict(),
  'organization.member.read': z.object({ members: referencesSchema }).strict(),
  'organization.member.add': z.object({ member: referenceSchema, role: assignableOrganizationRoleSchema }).strict(),
  'organization.member.role.update': z.object({ members: referencesSchema, role: assignableOrganizationRoleSchema }).strict(),
  'organization.member.activate': z.object({ members: referencesSchema }).strict(),
  'organization.member.suspend': z.object({ members: referencesSchema, reason: reasonSchema }).strict(),
  'organization.member.remove': z.object({ members: referencesSchema, reason: reasonSchema }).strict(),
  'scope.list': z.object({ query: z.string().trim().min(1).optional(), status: z.enum(['active', 'archived']).optional(), parentScopeKey: z.string().cuid().nullable().optional(), includeDescendants: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(50), cursor: z.string().optional() }).strict(),
  'scope.read': z.object({ scopes: referencesSchema }).strict(),
  'scope.create': z.object({ name: z.string().trim().min(1).max(160), description: z.string().trim().min(1).optional(), parentScope: referenceSchema.nullable().optional(), position: z.number().int().positive().default(1) }).strict(),
  'scope.update': z.object({ scope: referenceSchema, name: z.string().trim().min(1).max(160).optional(), description: z.string().trim().min(1).nullable().optional() }).strict().refine((value) => value.name !== undefined || value.description !== undefined, 'at least one update is required'),
  'scope.move': z.object({ scope: referenceSchema, parentScope: referenceSchema.nullable().optional(), position: z.number().int().positive().optional() }).strict().refine((value) => value.parentScope !== undefined || value.position !== undefined, 'parentScope or position is required'),
  'scope.archive': z.object({ scopes: referencesSchema, reason: reasonSchema, includeDescendants: z.boolean().default(false) }).strict(),
  'scope.restore': z.object({ scopes: referencesSchema, includeDescendants: z.boolean().default(false) }).strict(),
  'scope.remove': z.object({ scopes: referencesSchema, confirmation: z.string().trim().min(1).max(320), reason: reasonSchema }).strict(),
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
