import { z } from 'zod';
import { db, withTransaction } from '@/lib/db/client';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contextUserKey } from '@/lib/ai/tools/tool-context';
import { scopeSchema, type Scope } from './schema';
import { withArangoKey } from '@/lib/db/base';

const scopeNameSchema = z.string().trim().min(1).max(160);
const scopeDescriptionSchema = z.string().trim().min(1).max(10_000);

export const scopeListInputSchema = z.object({}).strict();
export const scopeCreateInputSchema = z.object({ name: scopeNameSchema, description: scopeDescriptionSchema.optional() }).strict();
export const scopeSelectInputSchema = z.object({ targetScopeKey: z.string().cuid() }).strict();
export const scopeUpdateInputSchema = z.object({ targetScopeKey: z.string().cuid(), name: scopeNameSchema.optional(), description: scopeDescriptionSchema.nullable().optional() }).strict();
export const scopeDeleteInputSchema = z.object({ targetScopeKey: z.string().cuid() }).strict();

export type PublicScope = {
  key: string;
  slug: string;
  name: string;
  summary: string;
  description: string | null;
  coverFileKey: string | null;
  position: number;
  isCurrent: boolean;
};

export class ScopeServiceError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT', message: string) {
    super(message);
    this.name = 'ScopeServiceError';
  }
}

function slugFor(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160) || 'scope';
}

function parseScope(row: Record<string, unknown>): Scope {
  return scopeSchema.parse(withArangoKey(row));
}

function publicScope(scope: Scope, currentScopeKey: string): PublicScope {
  return { key: scope.key, slug: scope.slug, name: scope.name, summary: scope.summary, description: scope.description, coverFileKey: scope.coverFileKey ?? null, position: scope.position, isCurrent: scope.key === currentScopeKey };
}

export interface ScopeService {
  list(context: ToolContext): Promise<{ scopes: PublicScope[] }>;
  create(input: z.input<typeof scopeCreateInputSchema>, context: ToolContext): Promise<{ scope: PublicScope }>;
  select(input: z.input<typeof scopeSelectInputSchema>, context: ToolContext): Promise<{ scope: PublicScope }>;
  update(input: z.input<typeof scopeUpdateInputSchema>, context: ToolContext): Promise<{ scope: PublicScope }>;
  delete(input: z.input<typeof scopeDeleteInputSchema>, context: ToolContext): Promise<{ deleted: true }>;
}

export function createScopeService(): ScopeService {
  return {
    async list(context) {
      const userKey = contextUserKey(context);
      const cursor = await db.query('FOR scope IN scopes FILTER scope.userKey == @userKey SORT scope.position ASC, scope._key ASC RETURN scope', { userKey });
      const scopes = (await cursor.all() as Record<string, unknown>[]).map(parseScope);
      return { scopes: scopes.map((scope) => publicScope(scope, context.runtimeScopeKey)) };
    },
    async create(raw, context) {
      const input = scopeCreateInputSchema.parse(raw);
      const userKey = contextUserKey(context);
      const now = new Date().toISOString();
      const created = await withTransaction(['scopes', 'users'], async (trx) => {
        const positionRow = await trx.query('RETURN LENGTH(FOR scope IN scopes FILTER scope.userKey == @userKey RETURN 1) + 1', { userKey });
        const position = Number(await positionRow.next() ?? 1);
        const key = newId();
        let slug = slugFor(input.name);
        const clash = await trx.query('RETURN LENGTH(FOR scope IN scopes FILTER scope.userKey == @userKey && scope.slug == @slug RETURN 1)', { userKey, slug });
        if (Number(await clash.next() ?? 0) > 0) slug = `${slug}-${key.slice(-6).toLowerCase()}`;
        const inserted = await trx.query('INSERT { _key: @key, userKey: @userKey, slug: @slug, name: @name, summary: @summary, description: @description, position: @position, embedding: [] } INTO scopes RETURN NEW', {
          key, userKey, slug, name: input.name, summary: input.name, description: input.description ?? input.name, position,
        });
        return inserted.next();
      });
      if (!created) throw new ScopeServiceError('CONFLICT', 'The scope could not be created.');
      return { scope: publicScope(parseScope(created as Record<string, unknown>), context.runtimeScopeKey) };
    },
    async select(raw, context) {
      const input = scopeSelectInputSchema.parse(raw);
      const userKey = contextUserKey(context);
      const updated = await withTransaction(['scopes', 'users'], async (trx) => {
        const found = await trx.query('LET scope = DOCUMENT(scopes, @key) FILTER scope != null && scope.userKey == @userKey UPDATE @userKey WITH { currentScopeKey: scope._key, updatedAt: @now } IN users RETURN scope', { key: input.targetScopeKey, userKey, now: new Date().toISOString() });
        return found.next();
      });
      if (!updated) throw new ScopeServiceError('NOT_FOUND', 'The scope was not found.');
      const scope = parseScope(updated as Record<string, unknown>);
      return { scope: publicScope(scope, scope.key) };
    },
    async update(raw, context) {
      const input = scopeUpdateInputSchema.parse(raw);
      const userKey = contextUserKey(context);
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) { patch.name = input.name; patch.summary = input.name; }
      if (input.description !== undefined) patch.description = input.description;
      if (!Object.keys(patch).length) throw new ScopeServiceError('CONFLICT', 'No scope fields to update.');
      const cursor = await db.query('FOR scope IN scopes FILTER scope._key == @key && scope.userKey == @userKey UPDATE scope WITH @patch IN scopes RETURN NEW', { key: input.targetScopeKey, userKey, patch });
      const row = await cursor.next();
      if (!row) throw new ScopeServiceError('NOT_FOUND', 'The scope was not found.');
      return { scope: publicScope(parseScope(row as Record<string, unknown>), context.runtimeScopeKey) };
    },
    async delete(raw, context) {
      const input = scopeDeleteInputSchema.parse(raw);
      const userKey = contextUserKey(context);
      const deleted = await withTransaction(['scopes', 'users', 'folders', 'files', 'conversations', 'conversationMessages'], async (trx) => {
        const scope = await trx.query('LET scope = DOCUMENT(scopes, @key) FILTER scope != null && scope.userKey == @userKey && scope.slug != "main" RETURN scope', { key: input.targetScopeKey, userKey });
        const row = await scope.next();
        if (!row) return false;
        await trx.query('FOR file IN files FILTER file.scopeKey == @key REMOVE file IN files', { key: input.targetScopeKey });
        await trx.query('FOR folder IN folders FILTER folder.scopeKey == @key REMOVE folder IN folders', { key: input.targetScopeKey });
        await trx.query('FOR message IN conversationMessages FILTER message.scopeKey == @key REMOVE message IN conversationMessages', { key: input.targetScopeKey });
        await trx.query('FOR conversation IN conversations FILTER conversation.scopeKey == @key REMOVE conversation IN conversations', { key: input.targetScopeKey });
        await trx.query('REMOVE @key IN scopes', { key: input.targetScopeKey });
        await trx.query('LET user = DOCUMENT(users, @userKey) FILTER user.currentScopeKey == @key LET main = FIRST(FOR scope IN scopes FILTER scope.userKey == @userKey && scope.slug == "main" RETURN scope) FILTER main != null UPDATE user WITH { currentScopeKey: main._key } IN users', { userKey, key: input.targetScopeKey });
        return true;
      });
      if (!deleted) throw new ScopeServiceError('CONFLICT', 'The main scope cannot be deleted.');
      return { deleted: true as const };
    },
  };
}

export const scopeService = createScopeService();
