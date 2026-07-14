import { describe, expect, test } from 'bun:test';
import { ACTION_SLUGS } from '@/lib/ai/actions';
import { PROVIDER_SLUGS } from '@/lib/ai/providers';
import { MODEL_SLUGS } from '@/lib/ai/models';
import { actionSchema } from './actions.node';
import { providerSchema } from './providers.node';
import { modelSchema } from './models.node';
import { modelActionSeedSchema } from './model-actions.node';
import { modelProviderSeedSchema } from './model-providers.node';
import { SEEDED_ACTIONS, SEEDED_MODELS, SEEDED_MODEL_ACTIONS, SEEDED_MODEL_PROVIDERS, SEEDED_PROVIDERS } from './seed';

const timestamp = '2026-07-14T12:00:00.000Z';

describe('action seeds', () => {
  test('seed every registered action exactly once', () => {
    const slugs = SEEDED_ACTIONS.map((action) => action.slug);

    expect([...slugs].sort()).toEqual([...ACTION_SLUGS].sort());
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(SEEDED_ACTIONS.map((action) => action.key)).size).toBe(SEEDED_ACTIONS.length);
  });

  test('match the persisted action schema and handler slug', () => {
    for (const seed of SEEDED_ACTIONS) {
      const parsed = actionSchema.parse({
        ...seed,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      expect(parsed.handlerKey).toBe(parsed.slug);
      expect(parsed.embedding).toEqual([]);
    }
  });
});

describe('provider seeds', () => {
  test('seed only OpenAI while keeping its slug registered', () => {
    const slugs = SEEDED_PROVIDERS.map((provider) => provider.slug);

    expect(slugs).toEqual(['openai']);
    expect(slugs.every((slug) => PROVIDER_SLUGS.includes(slug))).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(SEEDED_PROVIDERS.map((provider) => provider.key)).size).toBe(SEEDED_PROVIDERS.length);
  });

  test('match the persisted provider schema and handler slug', () => {
    for (const seed of SEEDED_PROVIDERS) {
      const parsed = providerSchema.parse(seed);

      expect(parsed.handlerKey).toBe(parsed.slug);
      expect(parsed.embedding).toEqual([]);
    }
  });
});

describe('model and routing relation seeds', () => {
  test('seed every runtime model exactly once', () => {
    const slugs = SEEDED_MODELS.map((model) => model.slug);

    expect([...slugs].sort()).toEqual([...MODEL_SLUGS].sort());
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(SEEDED_MODELS.map((model) => model.key)).size).toBe(SEEDED_MODELS.length);

    for (const seed of SEEDED_MODELS) {
      expect(modelSchema.parse(seed).embedding).toEqual([]);
    }
  });

  test('seed exactly the requested model-action links', () => {
    const parsed = SEEDED_MODEL_ACTIONS.map((seed) => modelActionSeedSchema.parse(seed));

    expect(parsed.map(({ modelSlug, actionSlug }) => `${modelSlug}:${actionSlug}`).sort()).toEqual([
      'openai.gpt-5.4-mini:core.reason',
      'openai.gpt-5.4-nano:core.ask',
    ]);
  });

  test('seed exactly one OpenAI route for each model', () => {
    const parsed = SEEDED_MODEL_PROVIDERS.map((seed) => modelProviderSeedSchema.parse(seed));

    expect(parsed.map(({ modelSlug, providerSlug, providerModelId }) => `${modelSlug}:${providerSlug}:${providerModelId}`).sort()).toEqual([
      'openai.gpt-5.4-mini:openai:gpt-5.4-mini',
      'openai.gpt-5.4-nano:openai:gpt-5.4-nano',
    ]);
  });
});
