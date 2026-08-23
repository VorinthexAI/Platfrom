import { describe, expect, test } from 'bun:test';
import { createEmailRepository } from './repository';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const documentKey = 'cmrnlzf650002qc7k4p5zem5w';

describe('mail Archive repository attachments', () => {
  test('accepts only references resolved inside the authorized scope', async () => {
    let bindVars: Record<string, unknown> | undefined;
    const database = { query: async (_query: string, values: Record<string, unknown>) => { bindVars = values; return { all: async () => [{ type: 'document', key: documentKey, name: 'Plan' }] }; }, collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    const refs = [{ type: 'document' as const, key: documentKey }];
    expect(await repository.resolveAttachments(scopeKey, refs)).toEqual(refs);
    expect(bindVars).toMatchObject({ scopeKey, refs });
  });

  test('rejects missing, cross-scope, and duplicate references', async () => {
    const database = { query: async () => ({ all: async () => [] }), collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    await expect(repository.resolveAttachments(scopeKey, [{ type: 'image', key: documentKey }])).rejects.toThrow('authorized scope');
    await expect(repository.resolveAttachments(scopeKey, [{ type: 'document', key: documentKey }, { type: 'document', key: documentKey }])).rejects.toThrow('unique');
  });
});
