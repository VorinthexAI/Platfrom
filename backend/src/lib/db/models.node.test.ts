import { describe, expect, test } from 'bun:test';
import { MODEL_SLUGS } from '@/lib/ai/models';
import { modelSchema, modelSlugSchema, modelsEmbedKeys } from './models.node';
import { modelActionSchema } from './model-actions.node';
import { modelProviderSchema } from './model-providers.node';

describe('model graph node schemas', () => {
  test('accepts registered model slugs and rejects invalid notation', () => {
    for (const slug of MODEL_SLUGS) expect(modelSlugSchema.parse(slug)).toBe(slug);
    expect(() => modelSlugSchema.parse('OpenAI/GPT 5')).toThrow();
  });

  test('embeds only semantic model text', () => {
    expect(modelsEmbedKeys.options).toEqual(['name', 'description', 'supportedUseCases']);
    const model = modelSchema.parse({
      key: 'model_1',
      slug: 'openai.gpt-5.4-nano',
      name: 'GPT-5.4 Nano',
      description: 'Fast model.',
      supportedUseCases: 'Conversation.',
    });
    expect(model.enabled).toBe(true);
    expect(model.embedding).toEqual([]);
  });

  test('relation nodes store keys and never semantic embeddings', () => {
    const modelAction = modelActionSchema.parse({ key: 'ma_1', modelKey: 'model_1', actionKey: 'action_1' });
    const modelProvider = modelProviderSchema.parse({
      key: 'mp_1',
      modelKey: 'model_1',
      providerKey: 'provider_1',
      providerModelId: 'gpt-5.4-nano',
    });

    expect(modelAction).toMatchObject({ priority: 100, enabled: true, embedding: [] });
    expect(modelProvider).toMatchObject({ enabled: true, embedding: [] });
  });
});
