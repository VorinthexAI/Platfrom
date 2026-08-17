import { z } from 'zod';
import { executeAction, type ExecuteActionOptions } from '@/lib/ai/router';
import { currentEmbeddingSchema, prepareEmbeddingText } from '@/lib/embeddings';
import { searchAccessibleImages, type AccessibleImageSearchInput, type AccessibleImageSearchResult } from '@/lib/media-library';
import type { EmbeddingInput, EmbeddingOutput, ProviderExecuteResponse } from '@/lib/ai/providers';
import type { DomainToolContext } from './domain-execute';
import { imageSearchActor, imageSimilarityOutput, imageSimilarityThresholdSchema, type ImageSimilarityOutput } from './image-similarity';
import { getDefaultGalleryRepository, type GalleryRepository } from '@/lib/gallery/repository';

const searchOptions = {
  threshold: imageSimilarityThresholdSchema.optional(),
  limit: z.number().int().min(1).max(50).default(50),
} as const;

const textSearchSchema = z.object({
  query: z.string().trim().min(1).max(12_000),
  collectionKey: z.string().cuid().optional(),
  recordHistory: z.boolean().default(true),
  ...searchOptions,
}).strict();
const similarImageSearchSchema = z.object({
  imageKey: z.string().cuid(),
  collectionKey: z.string().cuid().optional(),
  ...searchOptions,
}).strict();
const duplicateImageSearchSchema = z.object({ duplicates: z.literal(true), collectionKey: z.string().cuid() }).strict();

export const imageSearchInputSchema = z.union([textSearchSchema, similarImageSearchSchema, duplicateImageSearchSchema]);
export type ImageSearchInput = z.infer<typeof imageSearchInputSchema>;

export interface ImageSearchToolDependencies extends ExecuteActionOptions {
  context: DomainToolContext;
  executeEmbedding?: (organizationKey: string, input: EmbeddingInput) => Promise<ProviderExecuteResponse<EmbeddingOutput>>;
  searchImages?: (input: AccessibleImageSearchInput) => Promise<AccessibleImageSearchResult[]>;
  getImage?: GalleryRepository['getImage'];
  canAccessImage?: GalleryRepository['canAccessImage'];
  canAccessCollection?: GalleryRepository['canAccessCollection'];
  getCollection?: GalleryRepository['getCollection'];
  findDuplicateImages?: GalleryRepository['listRedundantCollectionImages'];
  onMetrics?: (metrics: { mode: 'text' | 'similar' | 'duplicates'; resultCount: number; durationMs: number }) => void;
}

const repository = getDefaultGalleryRepository();

export const imageSearchTool = {
  name: 'image.search',
  inputSchema: imageSearchInputSchema,
  providerDefinition: {
    name: 'image.search',
    description: 'Search accessible images by text, find images similar to a source image, or find deterministic duplicates within a collection.',
    inputSchema: {
      type: 'object',
      oneOf: [
        { type: 'object', required: ['query'], additionalProperties: false, properties: { query: { type: 'string', minLength: 1, maxLength: 12_000 }, collectionKey: { type: 'string' }, recordHistory: { type: 'boolean', default: true }, threshold: { type: 'number', minimum: -1, maximum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 50 } } },
        { type: 'object', required: ['imageKey'], additionalProperties: false, properties: { imageKey: { type: 'string' }, collectionKey: { type: 'string' }, threshold: { type: 'number', minimum: -1, maximum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 50 } } },
        { type: 'object', required: ['duplicates', 'collectionKey'], additionalProperties: false, properties: { duplicates: { type: 'boolean', const: true }, collectionKey: { type: 'string' } } },
      ],
    },
  },
  async execute(rawInput: unknown, dependencies: ImageSearchToolDependencies): Promise<ImageSimilarityOutput> {
    const startedAt = performance.now();
    const input = imageSearchInputSchema.parse(rawInput);
    const finish = (mode: 'text' | 'similar' | 'duplicates', output: ImageSimilarityOutput) => {
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
    if ('imageKey' in input) {
      const source = await (dependencies.getImage ?? repository.getImage)(input.imageKey);
      if (!source || source.scopeKey !== scopeKey || source.deletedAt || !await (dependencies.canAccessImage ?? repository.canAccessImage)(scopeKey, source.key, actorKey)) throw new Error('Source image not found.');
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
    const response = dependencies.executeEmbedding
      ? await dependencies.executeEmbedding(organizationKey, embeddingInput)
      : await executeAction<EmbeddingInput, EmbeddingOutput>({
          mode: 'auto',
          organizationKey,
          actionSlug: 'embed',
        }, embeddingInput, dependencies);
    const embedding = currentEmbeddingSchema.parse(response.output.embedding);
    const results = await (dependencies.searchImages ?? searchAccessibleImages)({
      organizationKey,
      scopeKey,
      actorKey,
      embedding,
      ...(input.collectionKey ? { collectionKey: input.collectionKey } : {}),
      threshold: input.threshold,
      limit: input.limit,
    });
    return finish('text', imageSimilarityOutput(results));
  },
} as const;
