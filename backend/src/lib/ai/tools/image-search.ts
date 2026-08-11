import { z } from 'zod';
import { executeAction, type ExecuteActionOptions } from '@/lib/ai/router';
import { currentEmbeddingSchema, prepareEmbeddingText } from '@/lib/embeddings';
import { searchAccessibleImages, type AccessibleImageSearchInput, type AccessibleImageSearchResult } from '@/lib/media-library';
import type { EmbeddingInput, EmbeddingOutput, ProviderExecuteResponse } from '@/lib/ai/providers';
import type { DomainToolContext } from './domain-execute';
import { imageSearchActor, imageSimilarityOutput, imageSimilarityThresholdSchema, type ImageSimilarityOutput } from './image-similarity';

export const imageSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(12_000),
  threshold: imageSimilarityThresholdSchema.optional(),
  limit: z.number().int().min(1).max(50).default(50),
}).strict();
export type ImageSearchInput = z.infer<typeof imageSearchInputSchema>;

export interface ImageSearchToolDependencies extends ExecuteActionOptions {
  context: DomainToolContext;
  executeEmbedding?: (organizationKey: string, input: EmbeddingInput) => Promise<ProviderExecuteResponse<EmbeddingOutput>>;
  searchImages?: (input: AccessibleImageSearchInput) => Promise<AccessibleImageSearchResult[]>;
}

export const imageSearchTool = {
  name: 'image.search',
  inputSchema: imageSearchInputSchema,
  providerDefinition: {
    name: 'image.search',
    description: 'Search accessible Gallery images by semantic similarity, ordered from best match to worst.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 12_000 },
        threshold: { type: 'number', minimum: -1, maximum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 50 },
      },
    },
  },
  async execute(rawInput: unknown, dependencies: ImageSearchToolDependencies): Promise<ImageSimilarityOutput> {
    const input = imageSearchInputSchema.parse(rawInput);
    const actorKey = imageSearchActor(dependencies.context);
    const embeddingInput = { text: prepareEmbeddingText(input.query, 'query') };
    const response = dependencies.executeEmbedding
      ? await dependencies.executeEmbedding(dependencies.context.organizationKey, embeddingInput)
      : await executeAction<EmbeddingInput, EmbeddingOutput>({
          mode: 'auto',
          organizationKey: dependencies.context.organizationKey,
          actionSlug: 'embed',
        }, embeddingInput, dependencies);
    const embedding = currentEmbeddingSchema.parse(response.output.embedding);
    const results = await (dependencies.searchImages ?? searchAccessibleImages)({
      organizationKey: dependencies.context.organizationKey,
      scopeKey: dependencies.context.runtimeScopeKey,
      actorKey,
      embedding,
      threshold: input.threshold,
      limit: input.limit,
    });
    return imageSimilarityOutput(results);
  },
} as const;
