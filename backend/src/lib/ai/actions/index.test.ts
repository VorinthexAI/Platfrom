import { describe, expect, test } from 'bun:test';
import { ACTION_SLUGS, ACTION_REGISTRY, assertActionRegistryIntegrity, getAction } from './index';
import { actionDefinitionSchema, isValidActionIdFormat } from './types';

describe('action registry', () => {
  test('passes the full integrity check', () => {
    expect(() => assertActionRegistryIntegrity()).not.toThrow();
  });

  test('contains every ACTION_SLUGS entry and nothing else', () => {
    const registryKeys = Object.keys(ACTION_REGISTRY).sort();
    expect(registryKeys).toEqual([...ACTION_SLUGS].sort());
  });

  test('has no duplicate action ids', () => {
    expect(new Set(ACTION_SLUGS).size).toBe(ACTION_SLUGS.length);
  });

  test('every id follows <domain>.<action> dot notation', () => {
    for (const id of ACTION_SLUGS) {
      expect(isValidActionIdFormat(id)).toBe(true);
    }
  });

  test('rejects malformed ids', () => {
    for (const bad of ['core', 'Core.chat', 'core.Chat', 'core..chat', 'a.b.c', 'core.ask-', '-core.ask', 'core_chat.x!']) {
      expect(isValidActionIdFormat(bad)).toBe(false);
    }
  });

  test('every action has a non-empty name and description', () => {
    for (const definition of Object.values(ACTION_REGISTRY)) {
      const parsed = actionDefinitionSchema.parse(definition);
      expect(parsed.name.length).toBeGreaterThan(0);
      expect(parsed.description.length).toBeGreaterThan(0);
    }
  });

  test('generation actions are not safe to retry, text actions are', () => {
    expect(getAction('image.generate').safeToRetry).toBe(false);
    expect(getAction('video.generate').safeToRetry).toBe(false);
    expect(getAction('audio.generate-music').safeToRetry).toBe(false);
    expect(getAction('core.ask').safeToRetry).toBe(true);
    expect(getAction('audio.transcribe').safeToRetry).toBe(true);
  });
});
