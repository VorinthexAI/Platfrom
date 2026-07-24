import { z } from 'zod';

export const SCOPES_COLLECTION = 'scopes';
export const SCOPE_SCOPES_COLLECTION = 'scopeScopes';
export const SCOPE_MEMBERS_COLLECTION = 'scopeMembers';
export const NEXUS_SCOPE_KEY = 'cmrnlzf640000qc7k4p5zem5w';

export const SCOPE_MEMBER_ROLES = ['owner', 'admin', 'moderator', 'viewer'] as const;
export const scopeMemberRoleSchema = z.enum(SCOPE_MEMBER_ROLES);
export type ScopeMemberRole = z.infer<typeof scopeMemberRoleSchema>;

export const scopeSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const scopeSchema = z.object({
  key: z.string().cuid(),
  // Organization keys may include preserved pre-CUID root identifiers.
  organizationKey: z.string().trim().min(1),
  slug: scopeSlugSchema,
  name: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable(),
  position: z.number().int().positive(),
  level: z.number().int().positive().default(1),
  deletedAt: z.string().nullable().default(null),
  embedding: z.array(z.number().finite()).default([]),
});

export type Scope = z.infer<typeof scopeSchema>;
export const scopesEmbedKeys = z.enum(['summary']);

export const scopeScopeSchema = z
  .object({
    key: z.string().cuid(),
    parentKey: z.string().cuid(),
    childKey: z.string().cuid(),
    level: z.number().int().positive().default(1),
    deletedAt: z.string().nullable().default(null),
  })
  .superRefine((relation, ctx) => {
    if (relation.parentKey === relation.childKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['childKey'],
        message: 'A scope cannot be its own parent',
      });
    }
  });

export type ScopeScope = z.infer<typeof scopeScopeSchema>;

export const scopeMemberSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  userOrganizationKey: z.string().cuid(),
  role: scopeMemberRoleSchema,
  status: z.enum(['active', 'suspended']).default('active'),
  source: z.enum(['explicit', 'organization']).default('explicit'),
});

export type ScopeMember = z.infer<typeof scopeMemberSchema>;
