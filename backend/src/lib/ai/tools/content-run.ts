import { z } from 'zod';
import { getUserById } from '@/lib/db/users.node';
import type { ToolContext } from './tool-context';
import { ContentError } from './content-errors';
import { contentToolNameSchema } from './content-registry';
import { runContentTool } from './content-runtime';
import type { ContentToolDependencies } from './content-runtime';
import { observeToolExecution, type ToolBillingDependencies } from '@/lib/ai/events/runtime';
import type { ToolEventRecorder } from '@/lib/ai/events/service';
import { db } from '@/lib/db/client';
import { scopeSchema } from '@/lib/ai/scopes/schema';
import { withArangoKey } from '@/lib/db/base';
import { memberPrincipal } from './tool-context';

export const runAuthenticatedContentToolInputSchema = z.object({
  scopeKey: z.string().cuid(),
  tool: contentToolNameSchema,
  input: z.unknown(),
}).strict();

export interface RunAuthenticatedContentToolOptions {
  authenticatedUserKey: string;
  requestKey?: string;
  recordEvent?: ToolEventRecorder;
  appScopeKey?: string;
  billing?: ToolBillingDependencies;
  resolveUser?: typeof getUserById;
  execute?: typeof runContentTool;
  contentDependencies?: ContentToolDependencies;
}

const contentExecutionContextSchema = z.object({
  scopeKey: z.string().cuid(),
  teamKey: z.string().trim().min(1).max(160).optional(),
}).strict();

export async function authorizeContentExecution(rawInput: z.input<typeof contentExecutionContextSchema>, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) {
  const input = contentExecutionContextSchema.parse(rawInput);
  const authenticatedUserKey = z.string().trim().min(1).parse(options.authenticatedUserKey);
  const user = await (options.resolveUser ?? getUserById)(authenticatedUserKey);
  if (!user) throw new ContentError('CONTENT_FORBIDDEN', 'Authenticated user was not found.', 'content.execution', { action: 'authorization' });
  const cursor = await db.query('LET scope = DOCUMENT(scopes, @scopeKey) FILTER scope != null && scope.userKey == @userKey RETURN scope', { scopeKey: input.scopeKey, userKey: authenticatedUserKey });
  const row = await cursor.next();
  if (!row) throw new ContentError('CONTENT_FORBIDDEN', 'Active scope access is required.', 'content.execution', { action: 'authorization' });
  scopeSchema.parse(withArangoKey(row as Record<string, unknown>));
  const context: ToolContext = { userKey: authenticatedUserKey, teamKey: authenticatedUserKey, runtimeScopeKey: input.scopeKey, principal: memberPrincipal(user) };
  return { input, context };
}

export async function authorizeContentTool(rawInput: z.input<typeof runAuthenticatedContentToolInputSchema>, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) {
  const input = runAuthenticatedContentToolInputSchema.parse(rawInput);
  const { context } = await authorizeContentExecution({ scopeKey: input.scopeKey }, options);
  return { input, context };
}

export async function runAuthenticatedContentTool(rawInput: z.input<typeof runAuthenticatedContentToolInputSchema>, options: RunAuthenticatedContentToolOptions) {
  const { input, context } = await authorizeContentTool(rawInput, options);
  const inputIdempotencyKey = typeof input.input === 'object' && input.input !== null && 'idempotencyKey' in input.input && typeof input.input.idempotencyKey === 'string'
    ? input.input.idempotencyKey
    : undefined;
  const idempotencyKey = options.requestKey ?? inputIdempotencyKey;
  return observeToolExecution(input.tool, context, () => (options.execute ?? runContentTool)(input.tool, input.input, context, options.contentDependencies), { recorder: options.recordEvent, appScopeKey: options.appScopeKey, idempotencyKey, input: input.input, ...options.billing });
}
