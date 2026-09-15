import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createEmailRepository } from './repository';
import { toArangoDoc } from '@/lib/db/base';

const userKey = 'cmrnlzf640001qc7kazsr96k5';
const scopeKey = 'cmrnlzf650002qc7k4p5zem5w';
const key = 'cmrnlzf660003qc7kmember001';
const at = '2026-09-15T00:00:00.000Z';
const exportedKey = (kind: string) => `c${createHash('sha256').update(`${kind}\0${key}`).digest('hex').slice(0, 24)}`;

test('received attachment projections point to exports without changing stored canonical references', async () => {
  for (const type of ['document', 'image'] as const) {
    const ref = { type, key };
    let parameters: any;
    const repository = createEmailRepository({ query: async (_query: string, vars: unknown) => {
      parameters = vars;
      return { all: async () => [{ ref, attachment: toArangoDoc({ key, userKey, scopeKey, teamKey: 'team', connectorKey: userKey, providerMessageId: 'message', partPath: '0.1', contentHash: 'a'.repeat(64), kind: type, filename: 'file', mimeType: 'text/plain', sizeBytes: 5, storageKey: 'canonical/bytes', status: 'completed', createdAt: at, updatedAt: at }) }] };
    } } as never);
    const result = await repository.attachmentReferencesForRead(userKey, [ref]);
    expect(result).toEqual([{ type, key: exportedKey(type === 'document' ? 'email-archive-export' : 'email-gallery-export') }]);
    expect(ref.key).toBe(key);
    expect(parameters.userKey).toBe(userKey);
  }
});

test('workspace attachment resolution carries authorized scope and preserves original filename/MIME', async () => {
  const calls: any[] = [];
  const repository = createEmailRepository({ query: async (_query: string, vars: unknown) => {
    calls.push(vars);
    return { all: async () => [{ type: 'document', key, name: 'Proposal', extension: 'pdf', mimeType: 'application/pdf', storageKey: 'original.pdf', sizeBytes: 5 }] };
  } } as never);
  expect(await repository.attachmentResources(userKey, [{ type: 'document', key }], scopeKey)).toEqual([{ type: 'document', key, name: 'Proposal.pdf', extension: 'pdf', mimeType: 'application/pdf', storageKey: 'original.pdf', sizeBytes: 5 }]);
  expect(calls[0]).toEqual({ userKey, scopeKey, refs: [{ type: 'document', key }] });
  const denied = createEmailRepository({ query: async () => ({ all: async () => [] }) } as never);
  await expect(denied.resolveAttachments(userKey, [{ type: 'document', key }], scopeKey)).rejects.toMatchObject({ reason: 'forbidden' });
  await expect(repository.resolveAttachments(userKey, [{ type: 'document', key, userKey } as never], scopeKey)).rejects.toThrow('Unrecognized key');
});
