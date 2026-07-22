import { expect, test } from 'bun:test'; import { upsertAction } from './upsert'; test('defines upsert', () => expect(upsertAction.id).toBe('upsert'));
