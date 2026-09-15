import { expect, test } from 'bun:test';
import { graphMigrations } from '.';
import { removeUnnamedConversationProjections, removeUnnamedConversationProjectionsMigration } from './0015-remove-unnamed-conversation-projections';

test('removes only unnamed managed chat projections and empty chat roots', async () => {
  const queries: string[] = [];
  const bindings: unknown[] = [];
  await removeUnnamedConversationProjections({
    query: async (query: string, variables: unknown) => { queries.push(query); bindings.push(variables); },
  } as never);

  expect(queries).toHaveLength(4);
  expect(queries.join('\n')).toContain('conversation.name == @defaultName');
  expect(queries.join('\n')).toContain('REMOVE document IN documents');
  expect(queries.join('\n')).toContain('REMOVE folder IN folders');
  expect(queries.join('\n')).toContain('REMOVE state IN conversationArchiveStates');
  expect(queries.at(-1)).toContain('FILTER child == null');
  expect(bindings.slice(0, 3)).toEqual(Array(3).fill({ defaultName: 'New chat' }));
  expect(graphMigrations.at(-1)).toBe(removeUnnamedConversationProjectionsMigration);
});
