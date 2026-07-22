import { z } from 'zod';
import { userOrganizationRoleSchema } from '@/lib/db/user-organization.node';
import { artifactDefinitionSchema } from '@/lib/artifacts/schema';
import { archiveToolInputSchemas } from './archive-schemas';
import { momentumToolInputSchemas } from '@/lib/ai/momentum/tool-schemas';

const referenceSchema = z.string().trim().min(1).max(320);
const referencesSchema = z.array(referenceSchema).min(1).max(100);
const reasonSchema = z.string().trim().min(1).max(500).optional();
const assignableOrganizationRoleSchema = userOrganizationRoleSchema.exclude(['member']);
const accessRoleSchema = z.enum(['owner', 'admin', 'moderator', 'viewer']);
const paginationSchema = { limit: z.number().int().min(1).max(100).default(50), cursor: z.string().optional() };

export const domainToolInputSchemas = {
  'artifact.create': z.object({
    name: z.string().trim().min(1).max(160),
    definition: artifactDefinitionSchema,
  }).strict(),
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
  'scope.member.list': z.object({ scope: referenceSchema, query: z.string().trim().min(1).optional(), status: z.enum(['active', 'suspended']).optional(), role: accessRoleSchema.optional(), source: z.enum(['direct', 'inherited']).optional(), ...paginationSchema }).strict(),
  'scope.member.read': z.object({ scope: referenceSchema, members: referencesSchema }).strict(),
  'scope.member.add': z.object({ scope: referenceSchema, members: referencesSchema, role: accessRoleSchema }).strict(),
  'scope.member.role.update': z.object({ scope: referenceSchema, members: referencesSchema, role: accessRoleSchema }).strict(),
  'scope.member.activate': z.object({ scope: referenceSchema, members: referencesSchema }).strict(),
  'scope.member.suspend': z.object({ scope: referenceSchema, members: referencesSchema, reason: reasonSchema }).strict(),
  'scope.member.remove': z.object({ scope: referenceSchema, members: referencesSchema, reason: reasonSchema }).strict(),
  'scope.agent.list': z.object({ scope: referenceSchema, query: z.string().trim().min(1).optional(), status: z.enum(['active', 'archived']).default('active'), minimumAccessRole: accessRoleSchema.optional(), sort: z.enum(['position', 'name', 'createdAt']).default('position'), ...paginationSchema }).strict(),
  'scope.agent.read': z.object({ scope: referenceSchema, agents: referencesSchema }).strict(),
  'scope.agent.add': z.object({ scope: referenceSchema, agent: referenceSchema, position: z.number().int().positive().default(1) }).strict(),
  'scope.agent.move': z.object({ agent: referenceSchema, fromScope: referenceSchema.optional(), toScope: referenceSchema.optional(), scope: referenceSchema.optional(), position: z.number().int().positive().optional() }).strict().superRefine((value, ctx) => { if (value.scope && (value.fromScope || value.toScope)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'scope cannot be combined with fromScope or toScope' }); if (!value.scope && (!value.fromScope || !value.toScope)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'fromScope and toScope are required for a move' }); if (value.scope && value.position === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'position is required when only reordering' }); }),
  'scope.agent.archive': z.object({ scope: referenceSchema, agents: referencesSchema, reason: reasonSchema }).strict(),
  'scope.agent.restore': z.object({ scope: referenceSchema, agents: referencesSchema }).strict(),
  'scope.agent.remove': z.object({ scope: referenceSchema, agents: referencesSchema, reason: reasonSchema }).strict(),
  'scope.agent.access-threshold.update': z.object({ scope: referenceSchema, agent: referenceSchema, minimumAccessRole: accessRoleSchema }).strict(),
  'agent.member.list': z.object({ scope: referenceSchema, agent: referenceSchema, source: z.enum(['inherited', 'explicit']).optional(), query: z.string().trim().min(1).optional(), ...paginationSchema }).strict(),
  'agent.member.read': z.object({ scope: referenceSchema, agent: referenceSchema, members: referencesSchema }).strict(),
  'agent.member.grant': z.object({ scope: referenceSchema, agent: referenceSchema, members: referencesSchema }).strict(),
  'agent.member.revoke': z.object({ scope: referenceSchema, agent: referenceSchema, members: referencesSchema }).strict(),
  'agent.member.sync': z.object({ scope: referenceSchema, agent: referenceSchema, dryRun: z.boolean().default(false) }).strict(),
  'organization.provider.list': z.object({ status: z.enum(['enabled', 'disabled']).optional(), query: z.string().trim().min(1).optional() }).strict(),
  'organization.provider.read': z.object({ providers: referencesSchema }).strict(),
  'organization.provider.enable': z.object({ provider: referenceSchema }).strict(),
  'organization.provider.disable': z.object({ provider: referenceSchema, reason: reasonSchema }).strict(),
  'organization.provider.test': z.object({ provider: referenceSchema, mode: z.enum(['connectivity', 'routing', 'minimal-inference']).default('connectivity') }).strict(),
  'organization.read': z.object({ organization: referenceSchema.optional() }).strict(),
  'organization.update': z.object({ name: z.string().trim().min(1).max(160).optional(), alias: z.string().trim().min(1).max(160).nullable().optional(), description: z.string().trim().min(1).max(4000).nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'at least one update is required'),
  'organization.archive': z.object({ reason: reasonSchema, confirmation: z.string().trim().min(1).max(320) }).strict(),
  'organization.restore': z.object({ confirmation: z.string().trim().min(1).max(320).optional() }).strict(),
  'access.organization.evaluate': z.object({ organization: referenceSchema.optional(), member: referenceSchema.optional(), action: z.string().trim().min(1).max(160).optional() }).strict(),
  'access.scope.evaluate': z.object({ scope: referenceSchema, member: referenceSchema.optional(), action: z.string().trim().min(1).max(160).optional() }).strict(),
  'access.agent.evaluate': z.object({ scope: referenceSchema, agent: referenceSchema, member: referenceSchema.optional(), action: z.enum(['read', 'run', 'delegate', 'manage']).default('run') }).strict(),
  'access.organization.explain': z.object({ organization: referenceSchema.optional(), member: referenceSchema.optional(), action: z.string().trim().min(1).max(160).optional() }).strict(),
  'access.scope.explain': z.object({ scope: referenceSchema, member: referenceSchema.optional(), action: z.string().trim().min(1).max(160).optional() }).strict(),
  'access.agent.explain': z.object({ scope: referenceSchema, agent: referenceSchema, member: referenceSchema.optional(), action: z.enum(['read', 'run', 'delegate', 'manage']).default('run') }).strict(),
  ...archiveToolInputSchemas,
  ...momentumToolInputSchemas,
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
