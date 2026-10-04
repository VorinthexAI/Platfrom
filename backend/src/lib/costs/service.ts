import { RERANK_SPARKS_PER_MILLION_TOKENS, STORAGE_SPARKS_PER_GB_MONTH } from './index';
import { publicSparkCostsSchema, type PublicSparkCosts } from './contracts';

export interface CostService {
  listCharges(): Promise<PublicSparkCosts>;
}

export function createCostService(): CostService {
  return Object.freeze({
    async listCharges() {
      return publicSparkCostsSchema.parse({
        capabilityCosts: {},
        charges: [
          { key: 'agent.image', kind: 'static' as const, name: 'Image generation', description: 'Generate or edit an image with up to eight references.', sparkCost: '15', unit: 'images' as const },
          { key: 'agent.video', kind: 'static' as const, name: 'Video generation', description: 'Generate a video with an optional first frame.', sparkCost: '15', unit: 'second' as const },
          { key: 'agent.speech', kind: 'static' as const, name: 'Speech generation', description: 'Generate speech from text using a chosen voice.', sparkCost: '1', unit: '100-characters' as const },
          { key: 'agent.query', kind: 'static' as const, name: 'Workspace reranking', description: 'Charged only when Core reranks workspace search results, based on processed tokens.', sparkCost: String(RERANK_SPARKS_PER_MILLION_TOKENS), unit: 'million-tokens' as const },
          {
            key: 'storage',
            kind: 'storage' as const,
            name: 'Storage',
            description: 'Stored files are measured continuously and charged hourly.',
            sparkCost: String(STORAGE_SPARKS_PER_GB_MONTH),
            unit: 'gb-month' as const,
          },
          {
            key: 'ai-usage',
            kind: 'variable' as const,
            name: 'AI actions',
            description: 'Supported AI actions consume Sparks based on usage.',
          },
        ],
      });
    },
  });
}

export const costService = createCostService();
