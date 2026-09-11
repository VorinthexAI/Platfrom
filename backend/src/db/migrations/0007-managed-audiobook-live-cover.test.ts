import { expect, test } from 'bun:test';
import { initialWorkspaceBookKey } from '@/lib/initial-workspace-content-identifiers';
import { removeManagedAudiobookStoredCover } from './0007-managed-audiobook-live-cover';

test('removes the stored cover only from deterministic managed audio books', async () => {
  const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
  const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
  const database = { query: async (query: string, bindVars?: Record<string, unknown>) => {
    calls.push({ query, bindVars });
    return { all: async () => [{ key: scopeKey }] };
  } };
  await removeManagedAudiobookStoredCover(database as never);
  expect(calls).toHaveLength(2);
  expect(calls[0]?.query).toContain('team.is_root != true');
  expect(calls[1]?.query).toContain('book.managed == true');
  expect(calls[1]?.query).toContain('keepNull: false');
  expect(calls[1]?.bindVars?.bookKeys).toEqual([initialWorkspaceBookKey(scopeKey)]);
});
