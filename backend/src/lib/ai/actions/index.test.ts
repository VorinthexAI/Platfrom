import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTION_SLUGS, assertActionRegistryIntegrity } from './index';
import { isValidActionIdFormat } from './types';

describe('action registry', () => {
  test('passes the full integrity check', () => {
    expect(() => assertActionRegistryIntegrity()).not.toThrow();
  });

  test('has no duplicate action ids', () => {
    expect(new Set(ACTION_SLUGS).size).toBe(ACTION_SLUGS.length);
  });

  test('every id follows lowercase dot notation', () => {
    for (const id of ACTION_SLUGS) {
      expect(isValidActionIdFormat(id)).toBe(true);
    }
  });

  test('rejects malformed ids', () => {
    for (const bad of ['core', 'Core.chat', 'core.Chat', 'core..chat', 'core.chat-', '-core.chat', 'core_chat.x!']) {
      expect(isValidActionIdFormat(bad)).toBe(false);
    }
  });

  test('contains no retired core.ask references in production source', () => {
    const sourceRoot = join(import.meta.dir, '..', '..');
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(path);
      }
    };
    visit(sourceRoot);
    // The seed migration is the sole historical-data exception; all runtime
    // paths must stay free of the retired action ID.
    const historicalMigration = join(sourceRoot, 'db', 'seed.ts');
    expect(files.filter((path) => path !== historicalMigration && readFileSync(path, 'utf8').includes('core.ask'))).toEqual([]);
  });

});
