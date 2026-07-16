import { knowledgeBlockSchema, searchableNodeSchema, type SearchableNode } from './schema';
import type { NodeResolver, ResolverAccess } from './resolver';

export interface SearchableDocument {
  key: string;
  organizationKey: string;
  scopeKey: string | null;
  embedding: readonly number[];
  updatedAt?: string | null;
  [field: string]: unknown;
}
export interface NodeResolverDataSource {
  get(nodeKey: string): Promise<SearchableDocument | null>;
  list(): Promise<readonly SearchableDocument[]>;
}
export interface CreateNodeResolverOptions {
  nodeType: string;
  embeddingFields: readonly string[];
  data: NodeResolverDataSource;
  canAccess?: (document: SearchableDocument, access: ResolverAccess) => boolean | Promise<boolean>;
  titleField?: string;
  summaryFields?: readonly string[];
  contentFields?: readonly string[];
}

function cosine(left: readonly number[], right: readonly number[]) {
  if (left.length === 0 || left.length !== right.length) return -1;
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
    leftNorm += (left[index] ?? 0) ** 2;
    rightNorm += (right[index] ?? 0) ** 2;
  }
  return leftNorm === 0 || rightNorm === 0 ? -1 : dot / Math.sqrt(leftNorm * rightNorm);
}

/** Builds a resolver whose model-facing values can only come from embeddingFields. */
export function createNodeResolver(options: CreateNodeResolverOptions): NodeResolver {
  const embeddingFields = [...options.embeddingFields];
  if (embeddingFields.length === 0 || new Set(embeddingFields).size !== embeddingFields.length) throw new Error('embeddingFields must be a non-empty unique list');
  const titleField = options.titleField ?? embeddingFields[0]!;
  const summaryFields = options.summaryFields ?? embeddingFields.slice(0, 2);
  const contentFields = options.contentFields ?? embeddingFields;
  for (const field of [titleField, ...summaryFields, ...contentFields]) if (!embeddingFields.includes(field)) throw new Error(`Context field is not declared in embeddingFields: ${field}`);
  const allowed = async (document: SearchableDocument, access: ResolverAccess) => {
    if (document.organizationKey !== access.organizationKey) return false;
    return options.canAccess ? options.canAccess(document, access) : document.scopeKey === null || document.scopeKey === access.scopeKey;
  };
  const normalize = (document: SearchableDocument): SearchableNode => searchableNodeSchema.parse({
    key: document.key,
    organizationKey: document.organizationKey,
    scopeKey: document.scopeKey,
    embedding: [...document.embedding],
    embeddingFields,
    fields: Object.fromEntries(embeddingFields.map((field) => [field, typeof document[field] === 'string' ? document[field] : String(document[field] ?? '')])),
    updatedAt: document.updatedAt ?? null,
  });
  return {
    nodeType: options.nodeType,
    async exists(nodeKey, access) { const document = await options.data.get(nodeKey); return Boolean(document && await allowed(document, access)); },
    async load(nodeKey, access) { const document = await options.data.get(nodeKey); return document && await allowed(document, access) ? normalize(document) : null; },
    async findSimilar(embedding, limit, access) {
      const results: Array<{ nodeKey: string; similarity: number }> = [];
      for (const document of await options.data.list()) if (await allowed(document, access)) results.push({ nodeKey: document.key, similarity: cosine(embedding, document.embedding) });
      return results.sort((left, right) => right.similarity - left.similarity || left.nodeKey.localeCompare(right.nodeKey)).slice(0, limit);
    },
    async extractContext(node, _access, extractOptions) {
      const title = node.fields[titleField]?.trim() || `${options.nodeType}/${node.key}`;
      const rawSummary = summaryFields.map((field) => node.fields[field]).filter(Boolean).join(' — ').trim() || title;
      const summary = rawSummary.length <= 2_000 ? rawSummary : `${rawSummary.slice(0, 1_999).trimEnd()}…`;
      const rawContent = contentFields.map((field) => node.fields[field]).filter(Boolean).join('\n\n').trim();
      const content = extractOptions.full ? (rawContent.length <= 20_000 ? rawContent : `${rawContent.slice(0, 19_999).trimEnd()}…`) || null : null;
      return knowledgeBlockSchema.parse({ nodeType: options.nodeType, nodeKey: node.key, title, summary, content, metadata: { scopeKey: node.scopeKey } });
    },
  };
}
