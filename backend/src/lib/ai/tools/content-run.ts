import { z } from 'zod';
import { getUserById } from '@/lib/db/users.node';
import { getUserOrganizationByOrganizationAndUser } from '@/lib/db/user-organization.node';
import type { ToolContext } from './tool-context';
import { ContentError } from './content-errors';
import { contentToolNameSchema } from './content-registry';
import { runContentTool } from './content-runtime';
import type { ContentToolDependencies } from './content-runtime';
import { evaluateScopeAccess } from './domain-access-engine';

export const runAuthenticatedContentToolInputSchema = z.object({
  organizationKey: z.string().trim().min(1),
  scopeKey: z.string().cuid(),
  tool: contentToolNameSchema,
  input: z.unknown(),
}).strict();

export interface RunAuthenticatedContentToolOptions {
  authenticatedUserKey: string;
  resolveMembership?: typeof getUserOrganizationByOrganizationAndUser;
  resolveUser?: typeof getUserById;
  authorizeScope?: typeof evaluateScopeAccess;
  execute?: typeof runContentTool;
  contentDependencies?: ContentToolDependencies;
}

const contentExecutionContextSchema = z.object({
  organizationKey: z.string().trim().min(1),
  scopeKey: z.string().cuid(),
}).strict();

/** Resolves an authenticated human's organization and scope authorization. */
export async function authorizeContentExecution(rawInput: z.input<typeof contentExecutionContextSchema>, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) {
  const input = contentExecutionContextSchema.parse(rawInput);
  const authenticatedUserKey = z.string().trim().min(1).parse(options.authenticatedUserKey);
  const membership = await (options.resolveMembership ?? getUserOrganizationByOrganizationAndUser)(input.organizationKey, authenticatedUserKey);
  if (!membership || membership.userId !== authenticatedUserKey || membership.status !== 'active') {
    throw new ContentError('CONTENT_FORBIDDEN', 'Active organization membership is required.', 'content.execution', { action: 'authorization' });
  }
  const user = await (options.resolveUser ?? getUserById)(authenticatedUserKey);
  if (!user) throw new ContentError('CONTENT_FORBIDDEN', 'Authenticated user was not found.', 'content.execution', { action: 'authorization' });
  const context = { organizationKey: input.organizationKey, runtimeScopeKey: input.scopeKey, principal: { kind: 'member' as const, user, userOrganization: membership, scopeMember: null } } satisfies ToolContext;
  const decision = await (options.authorizeScope ?? evaluateScopeAccess)(context, { scope: input.scopeKey, action: 'read' });
  if (!decision.allowed) throw new ContentError('CONTENT_FORBIDDEN', 'Active scope membership is required.', 'content.execution', { action: 'authorization' });
  return { input, context };
}

/** Authenticated human boundary for invoking a registered Content tool. */
export async function authorizeContentTool(rawInput: z.input<typeof runAuthenticatedContentToolInputSchema>, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) {
  const input = runAuthenticatedContentToolInputSchema.parse(rawInput);
  const { context } = await authorizeContentExecution({ organizationKey: input.organizationKey, scopeKey: input.scopeKey }, options);
  return { input, context };
}

/** Authenticated human boundary for invoking a registered Content tool. */
export async function runAuthenticatedContentTool(rawInput: z.input<typeof runAuthenticatedContentToolInputSchema>, options: RunAuthenticatedContentToolOptions) {
  const { input, context } = await authorizeContentTool(rawInput, options);
  return (options.execute ?? runContentTool)(input.tool, input.input, context, options.contentDependencies);
}
