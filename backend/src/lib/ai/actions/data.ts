import { z } from 'zod';
import { NODE_REGISTRY, type NodeAccessors } from '@/lib/db/registry';

/**
 * Generic data primitives delegate to a node or edge helper. The helpers own
 * key translation, schema validation, embeddings, and Arango persistence.
 */
export interface ActionNode<T, Insert, Patch> {
  insert(input: Insert): Promise<T>;
  getById(key: string): Promise<T | null>;
  updateById(key: string, patch: Patch): Promise<T>;
  upsertByKey(input: Insert): Promise<T>;
  deleteById(key: string): Promise<void>;
  getAllChunked(chunkSize?: number): AsyncGenerator<T[], void, void>;
}

const traverseValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const traverseInputSchema = z.object({
  node: z.string().min(1),
  where: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/), traverseValueSchema).default({}),
  similarity: z.object({
    embedding: z.array(z.number().finite()).min(1),
    threshold: z.number().finite().min(-1).max(1),
  }).strict().optional(),
}).strict();
export type TraverseInput = z.input<typeof traverseInputSchema>;

function cosineSimilarity(left: number[], right: number[]): number | null {
  if (left.length === 0 || left.length !== right.length) return null;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftMagnitude += left[index]! ** 2;
    rightMagnitude += right[index]! ** 2;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return null;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function matchesWhere(item: Record<string, unknown>, where: Record<string, z.infer<typeof traverseValueSchema>>): boolean {
  return Object.entries(where).every(([field, value]) => item[field] === value);
}

/** Traverses any registered node collection with strict flat selectors and optional embedding filtering. */
export async function traverseNodes(
  input: TraverseInput,
  registry: Record<string, Pick<NodeAccessors, 'listPage'>> = NODE_REGISTRY,
): Promise<Array<Record<string, unknown> & { similarity?: number }>> {
  const request = traverseInputSchema.parse(input);
  const node = registry[request.node];
  if (!node) throw new Error(`Unknown node collection: ${request.node}`);

  const results: Array<Record<string, unknown> & { similarity?: number }> = [];
  let after: string | undefined;
  do {
    const page = await node.listPage(after, 500);
    for (const rawItem of page.items) {
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue;
      const item = rawItem as Record<string, unknown>;
      if (!matchesWhere(item, request.where)) continue;
      const embedding = Array.isArray(item.embedding) && item.embedding.every((value) => typeof value === 'number') ? item.embedding : [];
      const similarity = request.similarity ? cosineSimilarity(request.similarity.embedding, embedding) : null;
      if (request.similarity && (similarity === null || similarity < request.similarity.threshold)) continue;
      results.push({ ...item, ...(similarity === null ? {} : { similarity }) });
    }
    after = page.nextCursor ?? undefined;
  } while (after);
  return results;
}

export function createDataActions<T, Insert, Patch>(node: ActionNode<T, Insert, Patch>) {
  return {
    read: <Result extends T = T>(key: string) => node.getById(key) as Promise<Result | null>,
    insert: <Result extends T = T>(input: Insert) => node.insert(input) as Promise<Result>,
    upsert: <Result extends T = T>(input: Insert) => node.upsertByKey(input) as Promise<Result>,
    update: <Result extends T = T>(key: string, patch: Patch) => node.updateById(key, patch) as Promise<Result>,
    delete: (key: string) => node.deleteById(key),
    async *traverse<Result extends T = T>(chunkSize?: number): AsyncGenerator<Result[], void, void> {
      for await (const chunk of node.getAllChunked(chunkSize)) yield chunk as Result[];
    },
  };
}
