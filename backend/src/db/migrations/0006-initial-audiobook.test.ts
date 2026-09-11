import { expect, test } from 'bun:test';
import { addInitialAudiobook } from './0006-initial-audiobook';

test('backfills one shared-asset audio book into every non-root workspace', async () => {
  const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
  const database = { query: async (query: string, bindVars?: Record<string, unknown>) => {
    calls.push({ query, bindVars });
    return { all: async () => [{ key: 'cmrnlzf640001qc7kazsr96k5', createdAt: '2026-09-09T00:00:00.000Z' }] };
  } };
  await addInitialAudiobook(database as never);
  expect(calls).toHaveLength(2);
  expect(calls[0]?.query).toContain('team.is_root != true');
  expect(calls[1]?.bindVars?.books).toHaveLength(1);
  expect(calls[1]?.bindVars?.chapters).toHaveLength(6);
  expect(JSON.stringify(calls[1]?.bindVars)).toContain('system/initial-audiobook/v1/chapter-06.mp3');
});
