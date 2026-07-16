import { describe, expect, test } from 'bun:test';
import { PROVIDER_SLUGS } from '@/lib/ai/providers';
import { newId } from '@/lib/ids';
import { providerSchema, providerSlugSchema, providersEmbedKeys } from './providers.node';

describe('provider node schema', () => {
  test('uses the AI provider registry as its slug source of truth', () => {
    expect(providerSlugSchema.options).toEqual([...PROVIDER_SLUGS]);
  });

  test('parses a provider and applies node defaults', () => {
    const provider = providerSchema.parse({
      key: newId(),
      slug: 'openai',
      name: 'OpenAI',
      description: 'Provides multimodal AI models.',
      supportedUseCases: 'Reasoning, language, image, and audio workloads.',
      handlerKey: 'openai',
    });

    expect(provider.enabled).toBe(true);
    expect(provider.embedding).toEqual([]);
  });

  test('embeds only semantic provider text', () => {
    expect(providersEmbedKeys.options).toEqual(['name', 'description', 'supportedUseCases']);
  });

  test('requires handlerKey to match slug', () => {
    expect(() => providerSchema.parse({
      key: newId(),
      slug: 'openai',
      name: 'OpenAI',
      description: 'Provides multimodal AI models.',
      supportedUseCases: 'Reasoning and language workloads.',
      handlerKey: 'anthropic',
    })).toThrow('handlerKey must match slug');
  });
});
