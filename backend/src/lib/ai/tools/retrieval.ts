import { z } from 'zod';
import { db } from '@/lib/db/client';
import { getNodeRetrievalMetadata } from '@/lib/db/base';
import { NODE_REGISTRY } from '@/lib/db/registry';

const MAX_NODES = 20;
const MAX_LIMIT = 50;
const MINIMUM_SCORE = 0.55;
const MAX_EMBEDDING_DIMENSIONS = 4_096;
const MAX_FILTER_VALUES = 50;

const filterValuesSchema = z.array(z.string().trim().min(1).max(160)).min(1).max(MAX_FILTER_VALUES).transform((values) => [...new Set(values)]);
export const retrievalFiltersSchema = z.object({
  keys: filterValuesSchema.optional(),
  organizationKey: z.string().trim().min(1).max(160).optional(),
  scopeKeys: filterValuesSchema.optional(),
  channelKeys: filterValuesSchema.optional(),
  statuses: filterValuesSchema.optional(),
}).strict();

export type RetrievalFilters = z.infer<typeof retrievalFiltersSchema>;

const retrievalNodeSchema = z.object({
  node: z.string().trim().min(1).max(100).refine((node) => Boolean(NODE_REGISTRY[node]), 'Unknown node'),
  embedding: z.array(z.number().finite()).min(1).max(MAX_EMBEDDING_DIMENSIONS).optional(),
  filters: retrievalFiltersSchema.optional(),
}).strict();

export const retrievalInputSchema = z.object({
  nodes: z.array(retrievalNodeSchema).min(1).max(MAX_NODES),
  limit: z.number().int().min(1).max(MAX_LIMIT),
}).strict().superRefine((input, context) => {
  const names = input.nodes.map(({ node }) => node);
  if (new Set(names).size !== names.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes'], message: 'Node names must be unique' });
});

export interface RetrievalContext {
  organizationKey: string;
  membershipKey: string;
  exclude?: Record<string, string[]>;
}

export interface RetrievalDocument {
  key: string;
  fields: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
  score?: number;
}

export interface RetrievalNodeResult {
  node: string;
  documents: RetrievalDocument[];
}

export interface RetrievalDependencies {
  retrieveNode?: (node: string, embedding: number[] | undefined, filters: RetrievalFilters | undefined, limit: number, context: RetrievalContext) => Promise<RetrievalDocument[]>;
  queryRetrieval?: (query: string, bindVars: Record<string, unknown>) => Promise<{ all(): Promise<unknown[]> }>;
}

function metadataFor(node: string) {
  const metadata = getNodeRetrievalMetadata(NODE_REGISTRY[node]!.listPage);
  if (!metadata || metadata.fields.length === 0 || !metadata.schemaFields.includes('embedding')) throw new Error(`Node ${node} has no safe semantic fields`);
  if (metadata.access === 'none') throw new Error(`Node ${node} has no retrieval access policy`);
  return metadata;
}

function validateFilters(node: string, filters: RetrievalFilters | undefined, context: RetrievalContext) {
  if (!filters) return;
  const metadata = metadataFor(node);
  if (filters.organizationKey && filters.organizationKey !== context.organizationKey) throw new Error('Retrieval organization filter must match the authorized organization');
  if (filters.organizationKey && metadata.access === 'global') throw new Error(`Node ${node} does not support organization filters`);
  if (filters.scopeKeys && !metadata.schemaFields.includes('scopeKey')) throw new Error(`Node ${node} does not support scope filters`);
  if (filters.channelKeys && metadata.access !== 'channel' && metadata.access !== 'channel-self') throw new Error(`Node ${node} does not support channel filters`);
  if (filters.statuses && !metadata.schemaFields.includes('status')) throw new Error(`Node ${node} does not support status filters`);
}

export async function retrieveNodeDocuments(node: string, embedding: number[] | undefined, filters: RetrievalFilters | undefined, limit: number, context: RetrievalContext, dependencies: RetrievalDependencies = {}): Promise<RetrievalDocument[]> {
  const metadata = metadataFor(node);
  validateFilters(node, filters, context);
  const has = (field: string) => metadata.schemaFields.includes(field);
  const query = `
    LET membership = DOCUMENT(userOrganizations, @membershipKey)
    LET membershipActive = membership != null && membership.organizationId == @organizationKey && membership.status == "active"
    LET viewerUserKey = membershipActive ? membership.userId : null
    LET privileged = membershipActive && membership.orgRole IN ["owner", "admin"]
    LET authorizedScopeKeys = !membershipActive ? [] : privileged ? (
      FOR scope IN scopes FILTER scope.organizationKey == @organizationKey RETURN scope._key
    ) : (
      FOR link IN scopeMembers
        FILTER link.userOrganizationKey == @membershipKey && link.status == "active"
        FOR scope IN scopes FILTER scope._key == link.scopeKey && scope.organizationKey == @organizationKey
        RETURN scope._key
    )
    LET authorizedChannelKeys = !membershipActive ? [] : (
      FOR channel IN channels
        FILTER channel.organizationKey == @organizationKey && channel.archivedAt == null
        FILTER LENGTH(FOR participant IN channelParticipants FILTER participant.channelKey == channel._key && participant.userOrganizationKey == @membershipKey LIMIT 1 RETURN 1) > 0
        RETURN channel._key
    )
    FOR document IN @@collection
      LET parentFolder = @hasFolderKey ? DOCUMENT(folders, document.folderKey) : null
      FILTER membershipActive
      FILTER !@hasArchivedAt || document.archivedAt == null
      FILTER !@hasInternalDeletion || document._internalDeletion == null
      FILTER !@hasFolderKey || ((!HAS(document, "folderKey") || document.folderKey == null) ? document.scopeKey IN authorizedScopeKeys : (parentFolder != null && parentFolder.scopeKey IN authorizedScopeKeys && parentFolder._internalDeletion == null))
      FILTER @access != "channel" || document.channelKey IN authorizedChannelKeys
      FILTER @access != "channel-self" || document._key IN authorizedChannelKeys
      FILTER @access != "scope" || document.scopeKey IN authorizedScopeKeys
      FILTER @access != "organization" || document.organizationKey == @organizationKey || document.organizationId == @organizationKey
      FILTER @access != "organization-self" || document._key == @organizationKey
      FILTER @access != "user" || document.userKey == viewerUserKey || document.userId == viewerUserKey
      FILTER document._key NOT IN @excludeKeys
      FILTER LENGTH(@filterKeys) == 0 || document._key IN @filterKeys
      FILTER @filterOrganizationKey == null || @filterOrganizationKey == @organizationKey
      FILTER LENGTH(@filterScopeKeys) == 0 || document.scopeKey IN @filterScopeKeys
      FILTER LENGTH(@filterChannelKeys) == 0 || (@access == "channel-self" ? document._key : document.channelKey) IN @filterChannelKeys
      FILTER LENGTH(@filterStatuses) == 0 || document.status IN @filterStatuses
      FILTER @dimensions == 0 || (IS_ARRAY(document.embedding) && LENGTH(document.embedding) > 0)
      FILTER @dimensions == 0 || LENGTH(document.embedding) == @dimensions
      LET score = @dimensions == 0 ? null : COSINE_SIMILARITY(document.embedding, @embedding)
      FILTER @dimensions == 0 || (IS_NUMBER(score) && score >= @minimumScore)
      SORT @dimensions == 0 ? 0 : score DESC, document.updatedAt DESC, document.createdAt DESC, document._key ASC
      LIMIT @limit
      LET selected = KEEP(document, @fields)
      RETURN MERGE({ key: document._key, fields: ZIP(ATTRIBUTES(selected), VALUES(selected)) },
        document.createdAt == null ? {} : { createdAt: document.createdAt },
        document.updatedAt == null ? {} : { updatedAt: document.updatedAt },
        score == null ? {} : { score })
  `;
  const bindVars = {
    '@collection': metadata.collectionName,
    access: metadata.access,
    organizationKey: context.organizationKey,
    membershipKey: context.membershipKey,
    excludeKeys: context.exclude?.[node] ?? [],
    filterKeys: filters?.keys ?? [],
    filterOrganizationKey: filters?.organizationKey ?? null,
    filterScopeKeys: filters?.scopeKeys ?? [],
    filterChannelKeys: filters?.channelKeys ?? [],
    filterStatuses: filters?.statuses ?? [],
    fields: metadata.fields,
    embedding: embedding ?? [],
    dimensions: embedding?.length ?? 0,
    minimumScore: MINIMUM_SCORE,
    limit,
    hasArchivedAt: has('archivedAt'),
    hasInternalDeletion: has('_internalDeletion'),
    hasFolderKey: has('folderKey'),
  };
  const cursor = dependencies.queryRetrieval
    ? await dependencies.queryRetrieval(query, bindVars)
    : await db.query<RetrievalDocument>(query, bindVars, { maxRuntime: 8, timeout: 8_000, memoryLimit: 64 * 1024 * 1024 });
  return z.array(z.object({
    key: z.string().min(1),
    fields: z.record(z.union([z.string(), z.number(), z.null()])).transform((fields) => Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string | number] => entry[1] !== null).map(([key, value]) => [key, String(value)]))),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    score: z.number().finite().min(-1).max(1).optional(),
  }).strict()).parse(await cursor.all());
}

export const retrievalTool = {
  name: 'retrieval',
  inputSchema: retrievalInputSchema,
  async execute(rawInput: unknown, context: RetrievalContext, dependencies: RetrievalDependencies = {}): Promise<RetrievalNodeResult[]> {
    const input = retrievalInputSchema.parse(rawInput);
    const retrieve = dependencies.retrieveNode ?? ((node, embedding, filters, limit, trustedContext) => retrieveNodeDocuments(node, embedding, filters, limit, trustedContext, dependencies));
    const results: RetrievalNodeResult[] = [];
    for (const { node, embedding, filters } of input.nodes) {
      validateFilters(node, filters, context);
      results.push({ node, documents: await retrieve(node, embedding, filters, input.limit, context) });
    }
    return results;
  },
} as const;
