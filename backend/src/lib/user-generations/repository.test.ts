import { expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createUserGenerationRepository } from './repository';

test('generation history aggregates and caps per user and type transactionally', async () => {
  const calls: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
  const value = { _key: newId(), userKey: newId(), type: 'image', prompt: 'A Globe', normalizedPrompt: 'a globe', usageCount: 2, generatedAt: '2026-08-31T00:00:00.000Z' };
  const database = { async query(query: string, bindVars: Record<string, unknown>) { calls.push({ query, bindVars }); return { async next() { return value; }, async all() { return []; } }; } };
  const repository = createUserGenerationRepository(database as never);
  const { _key, ...fields } = value;
  await repository.record({ ...fields, key: _key } as never);
  expect(calls[0]!.query).toContain('UPSERT { userKey: @userKey, type: @type, normalizedPrompt: @normalizedPrompt }');
  expect(calls[1]!.query).toContain('LIMIT 50');
  expect(calls[1]!.query).toContain('generation.type == @type');
});
