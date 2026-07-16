import { z } from 'zod';

export const SCOPES_COLLECTION = 'scopes';
export const SCOPE_SCOPES_COLLECTION = 'scopeScopes';
export const SCOPE_MEMBERS_COLLECTION = 'scopeMembers';

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
  organizationKey: z.string().cuid(),
  slug: scopeSlugSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(4_000),
  embedding: z.array(z.number().finite()).default([]),
});

export type Scope = z.infer<typeof scopeSchema>;
export const scopesEmbedKeys = z.enum(['name', 'description']);

export const scopeScopeSchema = z
  .object({
    key: z.string().cuid(),
    parentScopeKey: z.string().cuid(),
    childScopeKey: z.string().cuid(),
    position: z.number().int().positive(),
  })
  .superRefine((relation, ctx) => {
    if (relation.parentScopeKey === relation.childScopeKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['childScopeKey'],
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
});

export type ScopeMember = z.infer<typeof scopeMemberSchema>;
