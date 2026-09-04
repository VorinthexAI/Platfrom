import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { authorizeContentExecution, ContentError, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import {
  ScopeTagError,
  scopeTagCreateServiceInputSchema,
  scopeTagListInputIsUnambiguous,
  scopeTagListInputShape,
  scopeTagService,
  scopeTagTargetSchema,
  scopeTagUpdateInputSchema,
  type ScopeTagService,
} from '@/lib/scope-tags/service';
import { getAuthIdentity } from './security';
import { parseJson, parseQuery } from './validation';

const selector = { organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid() };
const listSchema = z.object({ ...selector, ...scopeTagListInputShape }).strict().refine(scopeTagListInputIsUnambiguous, { message: 'Choose target or targets, not both.', path: ['targets'] });
const createSchema = z.object({ ...selector, ...scopeTagCreateServiceInputSchema.shape }).strict();
const updateSchema = z.object({ ...selector, name: z.unknown().optional(), description: z.unknown().optional() }).strict().refine((value) => value.name !== undefined || value.description !== undefined, 'At least one field is required.');
const deleteSchema = z.object(selector).strict();
const distinct = <Schema extends z.ZodTypeAny>(schema: Schema, identity: (value: z.output<Schema>) => string) => z.array(schema).min(1).max(100).superRefine((values, context) => {
  const seen = new Set<string>();
  values.forEach((value, index) => { const id = identity(value); if (seen.has(id)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: 'Values must be distinct.' }); seen.add(id); });
});
const assignmentSchema = z.object({
  ...selector,
  targets: distinct(scopeTagTargetSchema, ({ type, key }) => `${type}\0${key}`),
  tagKeys: distinct(z.string().cuid(), (value) => value),
}).strict().refine(({ targets, tagKeys }) => targets.length * tagKeys.length <= 100, 'At most 100 assignment changes are allowed.');
const assignmentQuerySchema = z.object({ action: z.enum(['tag', 'untag']) }).strict();
const pathKeySchema = z.string().cuid();

export interface TagHandlerDependencies {
  service?: ScopeTagService;
  getIdentity?: typeof getAuthIdentity;
  authorize?: (input: { organizationKey: string; scopeKey: string }, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) => Promise<{ context: ToolContext }>;
  authorizationOptions?: Omit<RunAuthenticatedContentToolOptions, 'authenticatedUserKey' | 'execute'>;
}

export function createTagHandlers(dependencies: TagHandlerDependencies = {}) {
  const service = dependencies.service ?? scopeTagService;
  const run = (operation: (c: Context, userKey: string) => Promise<unknown>, status: 200 | 201 = 200) => async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity) return c.json({ success: false, error: { code: 'TAG_UNAUTHORIZED', message: 'Authentication required.' } }, 401);
    if (identity.identityType !== 'user') return c.json({ success: false, error: { code: 'TAG_FORBIDDEN', message: 'A user session is required.' } }, 403);
    try {
      const body = await operation(c, identity.key);
      return c.json({ success: true, data: body }, status);
    } catch (error) {
      if (error instanceof ScopeTagError) {
        const status = error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : error.code === 'NAME_CONFLICT' || error.code === 'CONFLICT' ? 409 : 400;
        return c.json({ success: false, error: { code: `TAG_${error.code}`, message: error.message } }, status);
      }
      if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' || error.code === 'CONTENT_UNAUTHORIZED' ? 403 : 400);
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'TAG_INVALID_INPUT', message: 'Tag request input was invalid.' } }, 400);
      console.error('tag request failed', { method: c.req.method, path: c.req.path, error });
      return c.json({ success: false, error: { code: 'TAG_FAILED', message: 'Tag request failed.' } }, 500);
    }
  };
  const authorized = async (body: { organizationKey: string; scopeKey: string }, userKey: string) => (dependencies.authorize ?? authorizeContentExecution)(body, { ...dependencies.authorizationOptions, authenticatedUserKey: userKey });

  return {
    list: run(async (c, userKey) => { const { organizationKey, scopeKey, ...input } = await parseJson(c, listSchema); const { context } = await authorized({ organizationKey, scopeKey }, userKey); return service.list(input, context); }),
    create: run(async (c, userKey) => { const { organizationKey, scopeKey, ...input } = await parseJson(c, createSchema); const { context } = await authorized({ organizationKey, scopeKey }, userKey); return service.create(input, context); }, 201),
    update: run(async (c, userKey) => { const { organizationKey, scopeKey, ...input } = await parseJson(c, updateSchema); const canonicalInput = scopeTagUpdateInputSchema.parse({ tagKey: pathKeySchema.parse(c.req.param('tagKey')), ...input }); const { context } = await authorized({ organizationKey, scopeKey }, userKey); return service.update(canonicalInput, context); }),
    delete: run(async (c, userKey) => { const body = await parseJson(c, deleteSchema); const { context } = await authorized(body, userKey); return service.delete({ tagKey: pathKeySchema.parse(c.req.param('tagKey')) }, context); }),
    assignments: run(async (c, userKey) => {
      const action = parseQuery(c, assignmentQuerySchema).action;
      const { organizationKey, scopeKey, targets, tagKeys } = await parseJson(c, assignmentSchema);
      const { context } = await authorized({ organizationKey, scopeKey }, userKey);
      const changes = targets.flatMap((target) => tagKeys.map((tagKey) => ({ tagKey, target, assigned: action === 'tag' })));
      return service.setAssignments({ changes }, context, { source: 'user' });
    }),
  };
}

export const tagHandlers = createTagHandlers();
