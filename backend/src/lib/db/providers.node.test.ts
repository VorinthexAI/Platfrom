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
      handlerKey: 'openai',
    });

    expect(provider.embedding).toEqual([]);
  });

  test('embeds the provider name and slug', () => {
    expect(providersEmbedKeys.options).toEqual(['name', 'slug']);
  });

  test('requires handlerKey to match slug', () => {
    expect(() => providerSchema.parse({
      key: newId(),
      slug: 'openai',
      name: 'OpenAI',
      handlerKey: 'anthropic',
    })).toThrow('handlerKey must match slug');
  });
});
