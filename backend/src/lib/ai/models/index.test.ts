import { describe, expect, test } from 'bun:test';
import { PROVIDER_SLUGS } from '@/lib/ai/providers/types';
import { ACTION_SLUGS } from '@/lib/ai/actions/types';
import type { ModelDefinition } from './types';
import {
  assertModelRegistryIntegrity,
  getModel,
  getModelsForAction,
  getRoutesForModel,
  MODEL_SLUGS,
  MODEL_REGISTRY,
  modelActionProfileSchema,
} from './index';

describe('model registry', () => {
  test('passes the full integrity check', () => {
    expect(() => assertModelRegistryIntegrity()).not.toThrow();
  });

  test('contains every MODEL_SLUGS entry and nothing else', () => {
    expect(Object.keys(MODEL_REGISTRY).sort()).toEqual([...MODEL_SLUGS].sort());
  });

  test('every route references a known provider', () => {
    const known = new Set<string>(PROVIDER_SLUGS);
    for (const model of Object.values(MODEL_REGISTRY)) {
      for (const route of model.routes) {
        expect(known.has(route.providerId)).toBe(true);
      }
    }
  });

  test('every claimed action is a known action with a profile', () => {
    const known = new Set<string>(ACTION_SLUGS);
    for (const model of Object.values<ModelDefinition>(MODEL_REGISTRY)) {
      for (const actionId of model.actions) {
        expect(known.has(actionId)).toBe(true);
        expect(model.actionProfiles[actionId]).toBeDefined();
      }
    }
  });

  test('every profile score is within [0, 1]', () => {
    for (const model of Object.values(MODEL_REGISTRY)) {
      for (const profile of Object.values(model.actionProfiles)) {
        for (const score of [profile.quality, profile.speed, profile.costEfficiency, profile.reliability]) {
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  test('profile schema rejects out-of-range scores', () => {
    expect(() =>
      modelActionProfileSchema.parse({ quality: 1.2, speed: 0.5, costEfficiency: 0.5, reliability: 0.5 }),
    ).toThrow();
    expect(() =>
      modelActionProfileSchema.parse({ quality: -0.1, speed: 0.5, costEfficiency: 0.5, reliability: 0.5 }),
    ).toThrow();
  });

  test('lookup helpers resolve models, actions, and routes', () => {
    expect(getModel('openai.gpt-5.4-mini').name).toBe('GPT-5.4 Mini');
    const chatModels = getModelsForAction('core.ask');
    expect(chatModels.map((model) => model.id)).toEqual(['openai.gpt-5.4-nano']);
    expect(getRoutesForModel('openai.gpt-5.4-mini').map((route) => route.providerId)).toEqual(['openai']);
  });
});
