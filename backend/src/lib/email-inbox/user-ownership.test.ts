import { describe, expect, test } from 'bun:test';
import { createConnectorRepository } from './connector-repository';
import { createInboxRepository } from './inbox-repository';

describe('private email ownership', () => {
  test('authorizes connectors by user independently of workspace destination', async () => {
    const calls: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
    const database = {
      collection: () => ({}),
      query: async (query: string, bindVars: Record<string, unknown>) => {
        calls.push({ query, bindVars });
        return { all: async () => [], next: async () => null };
      },
    };
    const repository = createConnectorRepository(database as never);
    await repository.listAuthorizedUser('cmrnlzf670004qc7kw1n9j94b');
    await repository.getExact('cmrnlzf670004qc7kw1n9j94b', 'cmrnlzf650002qc7k4p5zem5w');

    expect(calls.every(({ query }) => query.includes('connector.userKey == @userKey'))).toBe(true);
    expect(calls.every(({ bindVars }) => !Object.hasOwn(bindVars, 'scopeKey'))).toBe(true);
  });

  test('inbox lookup and search fence both resource and connector ownership', async () => {
    const queries: string[] = [];
    const database = { query: async (query: string) => { queries.push(query); return { all: async () => [], next: async () => null }; } };
    const repository = createInboxRepository(database as never);
    const userKey = 'cmrnlzf670004qc7kw1n9j94b';
    const connectorKey = 'cmrnlzf650002qc7k4p5zem5w';
    await repository.getByConnector(userKey, connectorKey);
    await repository.search(userKey, [connectorKey], [1, 0], 'mail', 0.5, 10);

    expect(queries.every((query) => query.includes('connector.userKey == @userKey'))).toBe(true);
    expect(queries.every((query) => query.includes('inbox.userKey == @userKey'))).toBe(true);
  });
});
