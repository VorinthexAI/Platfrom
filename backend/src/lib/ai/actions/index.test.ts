import { describe, expect, test } from 'bun:test';
import { ACTION_SLUGS, assertActionRegistryIntegrity } from './index';
import { isValidActionIdFormat } from './types';

describe('action registry', () => {
  test('passes the full integrity check', () => {
    expect(() => assertActionRegistryIntegrity()).not.toThrow();
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

});
