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
  key: z.string().cuid2(),
  organizationKey: z.string().cuid2(),
  slug: scopeSlugSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(4_000),
  embedding: z.array(z.number().finite()).default([]),
});

export type Scope = z.infer<typeof scopeSchema>;

export const scopeScopeSchema = z
  .object({
    key: z.string().cuid2(),
    parentScopeKey: z.string().cuid2(),
    childScopeKey: z.string().cuid2(),
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
  key: z.string().cuid2(),
  scopeKey: z.string().cuid2(),
  userOrganizationKey: z.string().cuid2(),
  role: scopeMemberRoleSchema,
});

export type ScopeMember = z.infer<typeof scopeMemberSchema>;
