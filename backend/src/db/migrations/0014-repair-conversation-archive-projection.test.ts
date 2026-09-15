import { expect, test } from 'bun:test';
import { graphMigrations } from '.';
import { repairConversationArchiveProjection, repairConversationArchiveProjectionMigration } from './0014-repair-conversation-archive-projection';

test('backfills missing projection states and advances existing conversations for repair', async () => {
  let query = '';
  let bindings: unknown;
  await repairConversationArchiveProjection({
    query: async (value: string, variables: unknown) => { query = value; bindings = variables; },
  } as never);

  expect(query).toContain('FOR conversation IN conversations');
  expect(query).toContain('candidate.teamKey == conversation.teamKey');
  expect(query).toContain('candidate.userId == conversation.userKey');
  expect(query).toContain('candidate.status == "active"');
  expect(query).toContain('UPSERT { _key: conversation._key }');
  expect(query).toContain('desiredRevision: 1');
  expect(query).toContain('projectedRevision: 0');
  expect(query).toContain('desiredRevision: OLD.desiredRevision + 1');
  expect(query).toContain('IN conversationArchiveStates');
  expect(bindings).toMatchObject({ repairedAt: expect.any(String) });
  expect(graphMigrations).toContain(repairConversationArchiveProjectionMigration);
});
