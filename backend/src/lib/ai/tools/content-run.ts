import { z } from 'zod';
import { getUserById } from '@/lib/db/users.node';
import { getUserTeamByTeamAndUser } from '@/lib/db/user-team.node';
import type { ToolContext } from './tool-context';
import { ContentError } from './content-errors';
import { contentToolNameSchema } from './content-registry';
import { runContentTool } from './content-runtime';
import type { ContentToolDependencies } from './content-runtime';
import { evaluateScopeAccess } from './domain-access-engine';
import { observeToolExecution, type ToolBillingDependencies } from '@/lib/ai/events/runtime';
import type { ToolEventRecorder } from '@/lib/ai/events/service';

export const runAuthenticatedContentToolInputSchema = z.object({
  teamKey: z.string().trim().min(1),
  scopeKey: z.string().cuid(),
  tool: contentToolNameSchema,
  input: z.unknown(),
}).strict();

export interface RunAuthenticatedContentToolOptions {
  authenticatedUserKey: string;
  teamAssurance?: { teamMembershipKey: string; teamMfaVersion: number };
  requestKey?: string;
  recordEvent?: ToolEventRecorder;
  appScopeKey?: string;
  billing?: ToolBillingDependencies;
  resolveMembership?: typeof getUserTeamByTeamAndUser;
  resolveUser?: typeof getUserById;
  authorizeScope?: typeof evaluateScopeAccess;
  execute?: typeof runContentTool;
  contentDependencies?: ContentToolDependencies;
}

const contentExecutionContextSchema = z.object({
  teamKey: z.string().trim().min(1),
  scopeKey: z.string().cuid(),
}).strict();

/** Resolves an authenticated human's team and scope authorization. */
export async function authorizeContentExecution(rawInput: z.input<typeof contentExecutionContextSchema>, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) {
  const input = contentExecutionContextSchema.parse(rawInput);
  const authenticatedUserKey = z.string().trim().min(1).parse(options.authenticatedUserKey);
  const membership = await (options.resolveMembership ?? getUserTeamByTeamAndUser)(input.teamKey, authenticatedUserKey);
  if (!membership || membership.userId !== authenticatedUserKey || membership.status !== 'active') {
    throw new ContentError('CONTENT_FORBIDDEN', 'Active team membership is required.', 'content.execution', { action: 'authorization' });
  }
  const user = await (options.resolveUser ?? getUserById)(authenticatedUserKey);
  if (!user) throw new ContentError('CONTENT_FORBIDDEN', 'Authenticated user was not found.', 'content.execution', { action: 'authorization' });
  const context = { teamKey: input.teamKey, runtimeScopeKey: input.scopeKey, principal: { kind: 'member' as const, user, userTeam: membership, scopeMember: null }, teamAssurance: options.teamAssurance } satisfies ToolContext;
  const decision = await (options.authorizeScope ?? evaluateScopeAccess)(context, { scope: input.scopeKey, action: 'read' });
  if (!decision.allowed) throw new ContentError('CONTENT_FORBIDDEN', 'Active scope membership is required.', 'content.execution', { action: 'authorization' });
  return { input, context };
}

/** Authenticated human boundary for invoking a registered Content tool. */
export async function authorizeContentTool(rawInput: z.input<typeof runAuthenticatedContentToolInputSchema>, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) {
  const input = runAuthenticatedContentToolInputSchema.parse(rawInput);
  const { context } = await authorizeContentExecution({ teamKey: input.teamKey, scopeKey: input.scopeKey }, options);
  return { input, context };
}

/** Authenticated human boundary for invoking a registered Content tool. */
export async function runAuthenticatedContentTool(rawInput: z.input<typeof runAuthenticatedContentToolInputSchema>, options: RunAuthenticatedContentToolOptions) {
  const { input, context } = await authorizeContentTool(rawInput, options);
  const inputIdempotencyKey = typeof input.input === 'object' && input.input !== null && 'idempotencyKey' in input.input && typeof input.input.idempotencyKey === 'string'
    ? input.input.idempotencyKey
    : undefined;
  const idempotencyKey = options.requestKey ?? inputIdempotencyKey;
  return observeToolExecution(input.tool, context, () => (options.execute ?? runContentTool)(input.tool, input.input, context, options.contentDependencies), { recorder: options.recordEvent, appScopeKey: options.appScopeKey, idempotencyKey, input: input.input, ...options.billing });
}
