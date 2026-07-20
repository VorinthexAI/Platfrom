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
