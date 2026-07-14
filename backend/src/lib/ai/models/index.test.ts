import { describe, expect, test } from 'bun:test';
import { PROVIDER_IDS } from '@/lib/ai/providers/types';
import { ACTION_IDS } from '@/lib/ai/actions/types';
import type { ModelDefinition } from './types';
import {
  assertModelRegistryIntegrity,
  getModel,
  getModelsForAction,
  getRoutesForModel,
  MODEL_IDS,
  MODEL_REGISTRY,
  modelActionProfileSchema,
} from './index';

describe('model registry', () => {
  test('passes the full integrity check', () => {
    expect(() => assertModelRegistryIntegrity()).not.toThrow();
  });

  test('contains every MODEL_IDS entry and nothing else', () => {
    expect(Object.keys(MODEL_REGISTRY).sort()).toEqual([...MODEL_IDS].sort());
  });

  test('every route references a known provider', () => {
    const known = new Set<string>(PROVIDER_IDS);
    for (const model of Object.values(MODEL_REGISTRY)) {
      for (const route of model.routes) {
        expect(known.has(route.providerId)).toBe(true);
      }
    }
  });

  test('every claimed action is a known action with a profile', () => {
    const known = new Set<string>(ACTION_IDS);
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
    expect(getModel('anthropic.claude-sonnet').name).toBe('Claude Sonnet');
    const chatModels = getModelsForAction('core.ask');
    expect(chatModels.map((model) => model.id)).toContain('openai.gpt-5');
    expect(chatModels.map((model) => model.id)).not.toContain('openai.gpt-image');
    expect(getRoutesForModel('xai.grok').map((route) => route.providerId)).toEqual(['xai', 'openrouter']);
  });
});
