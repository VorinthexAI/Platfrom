import { z } from 'zod';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { currentEmbeddingSchema, embedText } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { tagSchema, type Tag } from '@/lib/db/tags.node';
import { sourceTypeSchema, tagAssignmentSourceSchema } from '@/lib/db/tag-assignments.node';
import { getDefaultScopeTagRepository, isArangoUniqueConstraintError, ScopeTagRepositoryError, type ScopeTagOwner, type ScopeTagRepository } from './repository';

const key = z.string().cuid();
const cleanText = (maximum: number) => z.string().transform((value) => value.normalize('NFKC').trim().replace(/\s+/g, ' ')).pipe(z.string().min(1).max(maximum));
const optionalDescription = z.string().transform((value) => value.normalize('NFKC').trim().replace(/\s+/g, ' ')).pipe(z.string().max(2000)).optional().transform((value) => value || undefined);
export const scopeTagTargetSchema = z.object({ type: sourceTypeSchema, key }).strict();
const scopeTagTargetsSchema = z.array(scopeTagTargetSchema).min(1).max(100).superRefine((targets, context) => {
  const seen = new Set<string>();
  targets.forEach((target, index) => { const identity = `${target.type}\0${target.key}`; if (seen.has(identity)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: 'Targets must be distinct.' }); seen.add(identity); });
});
export const scopeTagListInputShape = { target: scopeTagTargetSchema.optional(), targets: scopeTagTargetsSchema.optional(), cursor: z.string().min(1).max(1000).optional(), limit: z.number().int().min(1).max(100).default(50) } as const;
export const scopeTagListInputIsUnambiguous = ({ target, targets }: { target?: unknown; targets?: unknown }) => !target || !targets;
export const scopeTagListInputSchema = z.object(scopeTagListInputShape).strict().refine(scopeTagListInputIsUnambiguous, { message: 'Choose target or targets, not both.', path: ['targets'] });
export const scopeTagCreateInputSchema = z.object({ name: cleanText(120), description: optionalDescription }).strict();
export const scopeTagCreateServiceInputSchema = scopeTagCreateInputSchema.extend({ key: key.optional() }).strict();
export const scopeTagUpdateInputSchema = z.object({ tagKey: key, name: cleanText(120).optional(), description: z.union([cleanText(2000), z.null()]).optional() }).strict().refine((value) => value.name !== undefined || value.description !== undefined, 'At least one field is required.');
export const scopeTagDeleteInputSchema = z.object({ tagKey: key }).strict();
const assignmentChangeSchema = z.object({ tagKey: key, target: scopeTagTargetSchema, assigned: z.boolean() }).strict();
export const scopeTagSetAssignmentsInputSchema = z.object({ changes: z.array(assignmentChangeSchema).min(1).max(100) }).strict().superRefine(({ changes }, context) => {
  const seen = new Set<string>();
  changes.forEach((change, index) => { const tuple = `${change.tagKey}\0${change.target.type}\0${change.target.key}`; if (seen.has(tuple)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['changes', index], message: 'Assignment tuples must be distinct.' }); seen.add(tuple); });
});
export const publicScopeTagSchema = tagSchema.omit({ scopeKey: true, userKey: true, normalizedName: true, embedding: true }).strict();
export const scopeTagTargetAssignmentStateSchema = z.object({ target: scopeTagTargetSchema, tagKeys: z.array(key) }).strict();
export const scopeTagListOutputSchema = z.object({ items: z.array(publicScopeTagSchema), nextCursor: z.string().nullable(), targetAssignments: z.array(scopeTagTargetAssignmentStateSchema).optional() }).strict();
export const scopeTagDeleteOutputSchema = z.object({ deletedKey: key }).strict();
export const scopeTagAssignmentResultSchema = assignmentChangeSchema.extend({ changed: z.boolean() }).strict();
export const scopeTagSetAssignmentsOutputSchema = z.object({ changes: z.array(scopeTagAssignmentResultSchema), changedCount: z.number().int().nonnegative(), assignedChanged: z.number().int().nonnegative(), unassignedChanged: z.number().int().nonnegative() }).strict();
const queryDateShape = { createdFrom: z.string().datetime().optional(), createdTo: z.string().datetime().optional() } as const;
export const scopeTagQueryInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list'), limit: z.number().int().min(1).max(50), ...queryDateShape }).strict(),
  z.object({ operation: z.literal('count'), ...queryDateShape }).strict(),
  z.object({ operation: z.literal('get'), key }).strict(),
  z.object({ operation: z.literal('search'), embedding: currentEmbeddingSchema, limit: z.number().int().min(1).max(50), ...queryDateShape }).strict(),
]);
const queryTagNamesSchema = z.array(cleanText(120)).min(1).max(20).superRefine((names, context) => { if (new Set(names.map(normalizeScopeTagName)).size !== names.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Tag names must be distinct after normalization.' }); });
const queryTagKeysSchema = z.array(key).min(1).max(20).superRefine((keys, context) => { if (new Set(keys).size !== keys.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Tag keys must be distinct.' }); });
const targetTypesSchema = z.array(sourceTypeSchema).min(1).max(sourceTypeSchema.options.length).superRefine((types, context) => { if (new Set(types).size !== types.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Target types must be distinct.' }); });
const assignmentFiltersShape = { tagNames: queryTagNamesSchema.optional(), tagKeys: queryTagKeysSchema.optional(), tagMatch: z.enum(['any', 'all']).default('any'), targetTypes: targetTypesSchema.optional() } as const;
export const scopeTagAssignmentQueryInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list'), ...assignmentFiltersShape, limit: z.number().int().min(1).max(50) }).strict(),
  z.object({ operation: z.literal('count'), ...assignmentFiltersShape }).strict(),
  z.object({ operation: z.literal('get'), key }).strict(),
]).superRefine((input, context) => { if ('tagNames' in input && input.tagNames && input.tagKeys) context.addIssue({ code: z.ZodIssueCode.custom, path: ['tagNames'], message: 'Choose tagNames or tagKeys, not both.' }); });
export const publicScopeTagAssignmentSchema = z.object({ key, tag: z.object({ key, name: z.string().min(1).max(120) }).strict(), target: scopeTagTargetSchema.extend({ label: z.string().trim().min(1).max(4_000) }).strict() }).strict();

const cursorSchema = z.object({ normalizedName: z.string().min(1).max(120), key }).strict();
const encodeCursor = (value: z.infer<typeof cursorSchema>) => Buffer.from(JSON.stringify(value)).toString('base64url');
function decodeCursor(value?: string) { if (!value) return undefined; try { return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))); } catch { throw new ScopeTagError('INVALID_CURSOR', 'Tag cursor is invalid.'); } }
export function normalizeScopeTagName(value: string) { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); }
const project = (tag: z.infer<typeof tagSchema>) => publicScopeTagSchema.parse({ key: tag.key, name: tag.name, ...(tag.description ? { description: tag.description } : {}), createdAt: tag.createdAt, updatedAt: tag.updatedAt });

function owner(context: ToolContext): ScopeTagOwner {
  if (context.principal.kind !== 'member') throw new ScopeTagError('FORBIDDEN', 'An authenticated member is required.');
  const { user, userOrganization } = context.principal;
  if (userOrganization.status !== 'active' || userOrganization.organizationId !== context.organizationKey || userOrganization.userId !== user.key) throw new ScopeTagError('FORBIDDEN', 'An active organization membership is required.');
  return { organizationKey: context.organizationKey, scopeKey: context.runtimeScopeKey, userKey: user.key, membershipKey: userOrganization.key };
}

export interface ScopeTagService {
  list(raw: unknown, context: ToolContext): Promise<z.infer<typeof scopeTagListOutputSchema>>;
  create(raw: unknown, context: ToolContext): Promise<z.infer<typeof publicScopeTagSchema>>;
  update(raw: unknown, context: ToolContext): Promise<z.infer<typeof publicScopeTagSchema>>;
  delete(raw: unknown, context: ToolContext): Promise<z.infer<typeof scopeTagDeleteOutputSchema>>;
  setAssignments(raw: unknown, context: ToolContext, options: { source: z.infer<typeof tagAssignmentSourceSchema> }): Promise<z.infer<typeof scopeTagSetAssignmentsOutputSchema>>;
  queryTags(raw: unknown, context: ToolContext): Promise<{ items?: z.infer<typeof publicScopeTagSchema>[]; count?: number }>;
  queryAssignments(raw: unknown, context: ToolContext): Promise<{ items?: z.infer<typeof publicScopeTagAssignmentSchema>[]; count?: number }>;
}

export function createScopeTagService(options: { repository?: ScopeTagRepository; embed?: typeof embedText; id?: () => string; now?: () => string } = {}): ScopeTagService {
  const repository = options.repository ?? getDefaultScopeTagRepository(), embed = options.embed ?? embedText, id = options.id ?? newId, now = options.now ?? (() => new Date().toISOString());
  const semantic = async (name: string, description?: string) => currentEmbeddingSchema.parse(await embed({ text: `${normalizeScopeTagName(name)}\n\n${description ?? ''}` }));
  return {
    async list(raw, context) { const input = scopeTagListInputSchema.parse(raw), owned = owner(context), rows = await repository.list(owned, { target: input.target, cursor: decodeCursor(input.cursor), limit: input.limit + 1 }); const hasMore = rows.length > input.limit, items = hasMore ? rows.slice(0, input.limit) : rows, last = items.at(-1); let targetAssignments; if (input.targets) { try { targetAssignments = await repository.listTargetAssignmentState(owned, input.targets, items.map(({ key }) => key)); } catch (error) { if (error instanceof ScopeTagRepositoryError && error.code === 'forbidden') throw new ScopeTagError('NOT_FOUND', 'Target not found.'); throw error; } } return scopeTagListOutputSchema.parse({ items: items.map(project), nextCursor: hasMore && last ? encodeCursor({ normalizedName: last.normalizedName, key: last.key }) : null, ...(targetAssignments ? { targetAssignments } : {}) }); },
    async create(raw, context) { const input = scopeTagCreateServiceInputSchema.parse(raw), owned = owner(context), timestamp = now(), normalizedName = normalizeScopeTagName(input.name); const matchesReplay = (existing: Tag) => existing.normalizedName === normalizedName && existing.description === input.description; if (input.key) { const existing = await repository.get(owned, input.key); if (existing) { if (matchesReplay(existing)) return project(existing); throw new ScopeTagError('CONFLICT', 'Tag key is already in use.'); } } const tag = tagSchema.parse({ key: input.key ?? id(), scopeKey: owned.scopeKey, userKey: owned.userKey, name: input.name, normalizedName, ...(input.description ? { description: input.description } : {}), embedding: await semantic(input.name, input.description), createdAt: timestamp, updatedAt: timestamp }); try { const saved = await repository.create(owned, tag); if (!saved) throw new ScopeTagError('FORBIDDEN', 'Scope access is required.'); return project(saved); } catch (error) { if (isArangoUniqueConstraintError(error)) { if (input.key) { const existing = await repository.get(owned, input.key); if (existing && matchesReplay(existing)) return project(existing); } throw new ScopeTagError('NAME_CONFLICT', 'A tag with this name already exists.'); } throw error; } },
    async update(raw, context) { const input = scopeTagUpdateInputSchema.parse(raw), owned = owner(context); const current = await repository.get(owned, input.tagKey); if (!current) throw new ScopeTagError('NOT_FOUND', 'Tag not found.'); const name = input.name ?? current.name, description = input.description === undefined ? current.description : input.description ?? undefined, normalizedName = normalizeScopeTagName(name); const patch = { name, normalizedName, description: description ?? null, embedding: await semantic(name, description), updatedAt: now() }; try { const saved = await repository.update(owned, input.tagKey, patch); if (!saved) throw new ScopeTagError('NOT_FOUND', 'Tag not found.'); return project(saved); } catch (error) { if (isArangoUniqueConstraintError(error)) throw new ScopeTagError('NAME_CONFLICT', 'A tag with this name already exists.'); throw error; } },
    async delete(raw, context) { const input = scopeTagDeleteInputSchema.parse(raw); if (!await repository.delete(owner(context), input.tagKey)) throw new ScopeTagError('NOT_FOUND', 'Tag not found.'); return scopeTagDeleteOutputSchema.parse({ deletedKey: input.tagKey }); },
    async setAssignments(raw, context, options) { const input = scopeTagSetAssignmentsInputSchema.parse(raw), source = tagAssignmentSourceSchema.parse(options.source); let results: Awaited<ReturnType<ScopeTagRepository['setAssignments']>>; try { results = await repository.setAssignments(owner(context), input.changes, source, input.changes.map(() => id()), now()); } catch (error) { if (error instanceof ScopeTagRepositoryError) throw new ScopeTagError(error.code === 'forbidden' ? 'NOT_FOUND' : 'CONFLICT', error.code === 'forbidden' ? 'Tag or target not found.' : error.message); throw error; } const changes = input.changes.map((change, index) => ({ ...change, changed: results[index]?.changed === true })); const assignedChanged = changes.filter((change) => change.assigned && change.changed).length, unassignedChanged = changes.filter((change) => !change.assigned && change.changed).length; return scopeTagSetAssignmentsOutputSchema.parse({ changes, changedCount: assignedChanged + unassignedChanged, assignedChanged, unassignedChanged }); },
    async queryTags(raw, context) {
      const input = scopeTagQueryInputSchema.parse(raw), owned = owner(context);
      if (input.operation === 'get') { const item = await repository.get(owned, input.key); if (!item) throw new ScopeTagError('NOT_FOUND', 'Tag not found.'); return { items: [project(item)] }; }
      if (input.operation === 'search') return { items: (await repository.searchOwned(owned, input.embedding, input.limit)).filter((item) => (!input.createdFrom || item.createdAt >= input.createdFrom) && (!input.createdTo || item.createdAt <= input.createdTo)).map((item) => ({ ...project(item), score: item.score })) as z.infer<typeof publicScopeTagSchema>[] };
      const rows: Tag[] = []; let cursor: { normalizedName: string; key: string } | undefined;
      do { const page = await repository.list(owned, { cursor, limit: 100 }); rows.push(...page); const last = page.at(-1); cursor = page.length === 100 && last ? { normalizedName: last.normalizedName, key: last.key } : undefined; } while (cursor);
      const filtered = rows.filter((item) => (!input.createdFrom || item.createdAt >= input.createdFrom) && (!input.createdTo || item.createdAt <= input.createdTo));
      return input.operation === 'count' ? { count: filtered.length } : { items: filtered.slice(0, input.limit).map(project) };
    },
    async queryAssignments(raw, context) {
      const input = scopeTagAssignmentQueryInputSchema.parse(raw), owned = owner(context);
      if (input.operation === 'get') { const item = await repository.getAssignment(owned, input.key); if (!item) throw new ScopeTagError('NOT_FOUND', 'Tag assignment not found.'); return { items: [publicScopeTagAssignmentSchema.parse(item)] }; }
      let tagKeys = input.tagKeys;
      if (input.tagNames) {
        const tags = await repository.resolveOwnedByNormalizedNames(owned, input.tagNames.map(normalizeScopeTagName));
        if (tags.length !== input.tagNames.length) throw new ScopeTagError('NOT_FOUND', 'Tag was not found in the authenticated user and scope.');
        tagKeys = tags.map(({ key }) => key);
      } else if (tagKeys) {
        const tags = await Promise.all(tagKeys.map((tagKey) => repository.get(owned, tagKey)));
        if (tags.some((tag) => !tag)) throw new ScopeTagError('NOT_FOUND', 'Tag was not found in the authenticated user and scope.');
      }
      const query = { tagKeys, tagMatch: input.tagMatch, targetTypes: input.targetTypes };
      if (input.operation === 'count') return { count: await repository.countAssignments(owned, query) };
      return { items: (await repository.listAssignments(owned, { ...query, limit: input.limit })).map((item) => publicScopeTagAssignmentSchema.parse(item)) };
    },
  };
}

export class ScopeTagError extends Error { constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'NAME_CONFLICT' | 'CONFLICT' | 'INVALID_CURSOR', message: string) { super(message); this.name = 'ScopeTagError'; } }
export const scopeTagServiceSchemas = { list: scopeTagListInputSchema, create: scopeTagCreateInputSchema, update: scopeTagUpdateInputSchema, delete: scopeTagDeleteInputSchema, setAssignments: scopeTagSetAssignmentsInputSchema } as const;
export const scopeTagService = createScopeTagService();
