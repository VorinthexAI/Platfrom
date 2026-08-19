import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createUserHiddenService, UserHiddenSourceNotFoundError } from './service';

describe('user hidden service', () => {
  test('is idempotent through the canonical repository and scopes by user', async () => {
    const actor = { userKey: newId(), organizationKey: newId(), membershipKey: newId() };
    const sourceKey = newId();
    const records = new Map<string, any>();
    const repository: any = {
      canAccess: async () => true,
      list: async (listActor: typeof actor) => [...records.values()].filter((record) => record.userKey === listActor.userKey),
      hide: async (record: any) => { const key = `${record.userKey}:${record.source}:${record.sourceKey}`; if (!records.has(key)) records.set(key, record); return records.get(key); },
      reveal: async (userKey: string, source: string, key: string) => records.delete(`${userKey}:${source}:${key}`) ? { userKey, source, sourceKey: key } : null,
    };
    const service = createUserHiddenService(repository, () => '2026-08-18T12:00:00.000Z');
    const first = await service.hide(actor, { source: 'collection', sourceKey });
    const second = await service.hide(actor, { source: 'collection', sourceKey });
    await service.hide({ ...actor, userKey: newId() }, { source: 'collection', sourceKey });
    expect(second).toEqual(first);
    expect(await service.list(actor)).toEqual([first]);
    expect(await service.reveal(actor, { source: 'collection', sourceKey })).not.toBeNull();
    expect(await service.reveal(actor, { source: 'collection', sourceKey })).toBeNull();
  });

  test('requires read access, including for shared-source validation', async () => {
    const repository: any = { canAccess: async () => false, hide: async () => { throw new Error('not reached'); }, reveal: async () => null, list: async () => [] };
    const service = createUserHiddenService(repository);
    await expect(service.hide({ userKey: newId(), organizationKey: newId(), membershipKey: newId() }, { source: 'image', sourceKey: newId() })).rejects.toBeInstanceOf(UserHiddenSourceNotFoundError);
  });

  test('preserves organization and membership context when listing', async () => {
    const actor = { userKey: newId(), organizationKey: newId(), membershipKey: newId() };
    let received: unknown;
    const repository: any = { list: async (value: unknown) => { received = value; return []; } };
    await createUserHiddenService(repository).list(actor);
    expect(received).toEqual(actor);
  });
});
