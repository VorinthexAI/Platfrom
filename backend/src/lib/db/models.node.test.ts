import { describe, expect, test } from 'bun:test';
import { MODEL_SLUGS } from '@/lib/ai/models';
import { modelSchema, modelSlugSchema, modelsEmbedKeys } from './models.node';
import { modelActionSchema } from './model-actions.node';
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
    const modelAction = modelActionSchema.parse({ key: newId(), modelKey, actionKey: newId() });
    const modelProvider = modelProviderSchema.parse({
      key: newId(),
      modelKey,
      providerKey: newId(),
      providerModelId: 'gpt-5.4-nano',
    });

    expect(modelAction).toMatchObject({ priority: 100, enabled: true });
    expect(modelProvider).toMatchObject({ enabled: true });
    expect(modelAction).not.toHaveProperty('embedding');
    expect(modelProvider).not.toHaveProperty('embedding');
  });
});
