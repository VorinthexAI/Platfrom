import { z } from 'zod';
import { executeAction, type ExecuteActionOptions } from '@/lib/ai/router';
import { currentEmbeddingSchema, prepareEmbeddingText } from '@/lib/embeddings';
import { searchAccessibleImages, type AccessibleImageSearchInput, type AccessibleImageSearchResult } from '@/lib/media-library';
import type { EmbeddingInput, EmbeddingOutput, ProviderExecuteResponse } from '@/lib/ai/providers';
import type { ToolContext } from './tool-context';
import { imageSearchActor, imageSimilarityOutput, imageSimilarityThresholdSchema, type ImageSimilarityOutput } from './image-similarity';
import { getDefaultGalleryRepository, type GalleryRepository } from '@/lib/gallery/repository';

const searchOptions = {
  threshold: imageSimilarityThresholdSchema.optional(),
  limit: z.number().int().min(1).max(50).default(50),
} as const;

const dateRangeOptions = {
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
} as const;

const textSearchSchema = z.object({
  query: z.string().trim().min(1).max(12_000),
  collectionKey: z.string().cuid().optional(),
  recordHistory: z.boolean().default(true),
  ...searchOptions,
  ...dateRangeOptions,
}).strict();
const similarImageSearchSchema = z.object({
  imageKey: z.string().cuid(),
  collectionKey: z.string().cuid().optional(),
  ...searchOptions,
}).strict();
const identitySearchSchema = z.object({
  identityKey: z.string().cuid(),
  collectionKey: z.string().cuid().optional(),
}).strict();
const duplicateImageSearchSchema = z.object({ duplicates: z.literal(true), collectionKey: z.string().cuid() }).strict();

export const imageSearchInputSchema = z.union([textSearchSchema, similarImageSearchSchema, identitySearchSchema, duplicateImageSearchSchema]);
export type ImageSearchInput = z.infer<typeof imageSearchInputSchema>;
export const nonTextImageSearchInputSchema = z.union([similarImageSearchSchema, identitySearchSchema, duplicateImageSearchSchema]);

export const imageSearchProviderInputSchema = {
  type: 'object',
  oneOf: [
    { type: 'object', required: ['query'], additionalProperties: false, properties: { query: { type: 'string', minLength: 1, maxLength: 12_000 }, collectionKey: { type: 'string' }, recordHistory: { type: 'boolean', default: true }, threshold: { type: 'number', minimum: -1, maximum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 50 } } },
    { type: 'object', required: ['imageKey'], additionalProperties: false, properties: { imageKey: { type: 'string' }, collectionKey: { type: 'string' }, threshold: { type: 'number', minimum: -1, maximum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 50 } } },
    { type: 'object', required: ['identityKey'], additionalProperties: false, properties: { identityKey: { type: 'string' }, collectionKey: { type: 'string' } } },
    { type: 'object', required: ['duplicates', 'collectionKey'], additionalProperties: false, properties: { duplicates: { type: 'boolean', const: true }, collectionKey: { type: 'string' } } },
  ],
} as const;
export const nonTextImageSearchProviderInputSchema = { type: 'object', oneOf: imageSearchProviderInputSchema.oneOf.slice(1) } as const;

export interface ImageSearchToolDependencies extends ExecuteActionOptions {
  context: ToolContext;
  executeEmbedding?: (organizationKey: string, input: EmbeddingInput) => Promise<ProviderExecuteResponse<EmbeddingOutput>>;
  /** Trusted query embedding supplied by a canonical parent operation. */
  queryEmbedding?: number[];
  searchImages?: (input: AccessibleImageSearchInput) => Promise<AccessibleImageSearchResult[]>;
  listMatchingVisualIdentities?: (scopeKey: string, query: string) => ReturnType<GalleryRepository['listMatchingIdentityNames']>;
  getImage?: GalleryRepository['getImage'];
  getVisualIdentity?: GalleryRepository['getVisualIdentity'];
  canAccessImage?: GalleryRepository['canAccessImage'];
  canAccessCollection?: GalleryRepository['canAccessCollection'];
  getCollection?: GalleryRepository['getCollection'];
  findDuplicateImages?: GalleryRepository['listRedundantCollectionImages'];
  listVisualIdentityImages?: (scopeKey: string, identityKey: string, collectionKey?: string) => ReturnType<GalleryRepository['listSubjectImages']>;
  onMetrics?: (metrics: { mode: 'text' | 'similar' | 'identity' | 'duplicates'; resultCount: number; durationMs: number }) => void;
}

const repository = getDefaultGalleryRepository();

export const imageSearchTool = {
  name: 'image.search',
  inputSchema: imageSearchInputSchema,
  providerDefinition: {
    name: 'image.search',
    description: 'Search accessible images by text, a source image, or a saved visual identity, or find deterministic duplicates within a collection.',
    inputSchema: imageSearchProviderInputSchema,
  },
  async execute(rawInput: unknown, dependencies: ImageSearchToolDependencies): Promise<ImageSimilarityOutput> {
    const startedAt = performance.now();
    const input = imageSearchInputSchema.parse(rawInput);
    const finish = (mode: 'text' | 'similar' | 'identity' | 'duplicates', output: ImageSimilarityOutput) => {
      const metrics = { mode, resultCount: output.images.length, durationMs: performance.now() - startedAt };
      console.info('image search completed', metrics);
      dependencies.onMetrics?.(metrics);
      return output;
    };
    const actorKey = imageSearchActor(dependencies.context);
    const scopeKey = dependencies.context.runtimeScopeKey;
    const organizationKey = dependencies.context.organizationKey;
    if ('collectionKey' in input && input.collectionKey) {
      if (!await (dependencies.canAccessCollection ?? repository.canAccessCollection)(scopeKey, input.collectionKey, actorKey)) throw new Error('Image collection not found.');
      const collection = await (dependencies.getCollection ?? repository.getCollection)(scopeKey, input.collectionKey);
      if (!collection) throw new Error('Image collection not found.');
    }
    if ('duplicates' in input) {
      const duplicates = await (dependencies.findDuplicateImages ?? repository.listRedundantCollectionImages)(scopeKey, input.collectionKey);
      return finish('duplicates', imageSimilarityOutput(duplicates.slice(0, 500).map((image) => ({ image }))));
    }
    if ('identityKey' in input) {
      const identity = await (dependencies.getVisualIdentity ?? repository.getVisualIdentity)(scopeKey, input.identityKey, actorKey);
      if (!identity) throw new Error('Visual identity not found.');
      const matches = dependencies.listVisualIdentityImages
        ? await dependencies.listVisualIdentityImages(scopeKey, identity.key, input.collectionKey)
        : await repository.listSubjectImages(scopeKey, identity.key, actorKey, input.collectionKey);
      return finish('identity', imageSimilarityOutput(matches.map(({ image, confidence }) => ({ image, score: confidence }))));
    }
    if ('imageKey' in input) {
      const source = await (dependencies.getImage ?? repository.getImage)(input.imageKey);
      if (!source || source.scopeKey !== scopeKey || !await (dependencies.canAccessImage ?? repository.canAccessImage)(scopeKey, source.key, actorKey)) throw new Error('Source image not found.');
      const results = await (dependencies.searchImages ?? repository.searchAccessibleImages)({
        organizationKey,
        scopeKey,
        actorKey,
        embedding: source.embedding,
        ...(input.collectionKey ? { collectionKey: input.collectionKey } : {}),
        threshold: input.threshold,
        limit: input.limit + 1,
      });
      return finish('similar', imageSimilarityOutput(results.filter(({ image }) => image.key !== source.key).slice(0, input.limit)));
    }
    const embeddingInput = { text: prepareEmbeddingText(input.query, 'query') };
    const embeddingPromise = dependencies.queryEmbedding
      ? Promise.resolve({ output: { embedding: dependencies.queryEmbedding } })
      : dependencies.executeEmbedding
      ? dependencies.executeEmbedding(organizationKey, embeddingInput)
      : executeAction<EmbeddingInput, EmbeddingOutput>({
          mode: 'auto',
          organizationKey,
          actionSlug: 'embed',
        }, embeddingInput, dependencies);
    const [response, identities] = await Promise.all([
      embeddingPromise,
      dependencies.listMatchingVisualIdentities
        ? dependencies.listMatchingVisualIdentities(scopeKey, input.query)
        : repository.listMatchingIdentityNames(scopeKey, input.query, actorKey),
    ]);
    const embedding = currentEmbeddingSchema.parse(response.output.embedding);
    const search = dependencies.searchImages ?? searchAccessibleImages;
    const searchDateRange = { ...(input.createdFrom ? { createdFrom: input.createdFrom } : {}), ...(input.createdTo ? { createdTo: input.createdTo } : {}) };
    const [semanticResults, ...identityResults] = await Promise.all([
      search({
        organizationKey,
        scopeKey,
        actorKey,
        embedding,
        ...(input.collectionKey ? { collectionKey: input.collectionKey } : {}),
        threshold: input.threshold,
        limit: input.limit,
        ...searchDateRange,
      }),
      ...identities.map((identity) => search({
        organizationKey,
        scopeKey,
        actorKey,
        embedding: identity.embedding,
        ...(input.collectionKey ? { collectionKey: input.collectionKey } : {}),
        limit: input.limit,
        ...searchDateRange,
      })),
    ]);
    const merged = new Map<string, AccessibleImageSearchResult>();
    for (const result of identityResults.flat()) if (!merged.has(result.image.key)) merged.set(result.image.key, result);
    for (const result of semanticResults) if (!merged.has(result.image.key)) merged.set(result.image.key, result);
    return finish('text', imageSimilarityOutput([...merged.values()].slice(0, input.limit)));
  },
} as const;
