import { describe, expect, test } from 'bun:test';
import { MODEL_SLUGS } from '@/lib/ai/models';
import { modelSchema, modelSlugSchema, modelsEmbedKeys } from './models.node';
import { modelProviderSchema } from './model-providers.node';
import { newId } from '@/lib/ids';

describe('model graph node schemas', () => {
  test('accepts registered model slugs and rejects invalid notation', () => {
    for (const slug of MODEL_SLUGS) expect(modelSlugSchema.parse(slug)).toBe(slug);
    expect(() => modelSlugSchema.parse('OpenAI/GPT 5')).toThrow();
  });

  test('embeds only semantic model text', () => {
    expect(modelsEmbedKeys.options).toEqual(['name', 'description', 'supportedUseCases']);
    const model = modelSchema.parse({
      key: newId(),
      slug: 'openai.gpt-5.4-nano',
      name: 'GPT-5.4 Nano',
      description: 'Fast model.',
      supportedUseCases: 'Conversation.',
    });
    expect(model.enabled).toBe(true);
    expect(model.embedding).toEqual([]);
  });

  test('relation nodes store keys and never semantic embeddings', () => {
    const modelKey = newId();
    const modelProvider = modelProviderSchema.parse({
      key: newId(),
      modelKey,
      providerKey: newId(),
      providerModelId: 'gpt-5.4-nano',
    });

    expect(modelProvider).toMatchObject({ enabled: true });
    expect(modelProvider).not.toHaveProperty('embedding');
  });
});
