import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createConversationRepository } from './repository';
import type { ConversationMessage } from './schemas';

const timestamp = '2026-09-01T00:00:00.000Z';
const turnMessage = (role: 'USER' | 'ASSISTANT', overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({ key: newId(), conversationKey: newId(), organizationKey: 'organization', scopeKey: newId(), userKey: newId(), turnKey: 'request', requestHash: 'a'.repeat(64), role, status: role === 'USER' ? 'COMPLETED' : 'PENDING', content: role === 'USER' ? 'question' : 'Pending', createdAt: timestamp, ...(role === 'USER' ? { completedAt: timestamp } : {}), ...overrides });
const raw = ({ key, ...value }: ConversationMessage) => ({ _key: key, ...value });

describe('conversation repository boundaries', () => {
  test('uses favorite-first stable cursor ordering and newest-first message scans', async () => {
    const queries: string[] = []; const bindings: any[] = [];
    const database: any = { query: async (value: string, bind: unknown) => { queries.push(value); bindings.push(bind); return { all: async () => [], next: async () => [] }; } };
    const repository = createConversationRepository(database); const owner = { organizationKey: 'organization', scopeKey: newId(), userKey: newId() };
    await repository.list(owner, { limit: 26, favoriteOnly: false });
    await repository.listMessages(owner, newId(), undefined, 26);
    expect(queries[0]).toContain('SORT conversation.isFavorite DESC, conversation.updatedAt DESC, conversation._key ASC');
    expect(queries[0]).toContain('FILTER !@favoriteOnly || conversation.isFavorite == true');
    expect(queries[0]).toContain('@cursor.updatedAt');
    expect(bindings[0]).toMatchObject({ favoriteOnly: false, cursor: null, limit: 26 });
    expect(queries[1]).toContain('SORT message.createdAt DESC, message._key DESC');
  });

  test('combines favorite-only filtering with a stable pagination cursor', async () => {
    let vars: any;
    const database: any = { query: async (_value: string, bind: unknown) => { vars = bind; return { all: async () => [] }; } };
    const repository = createConversationRepository(database), owner = { organizationKey: 'organization', scopeKey: newId(), userKey: newId() };
    const cursor = { favorite: true, updatedAt: timestamp, key: newId() };
    await repository.list(owner, { query: 'roadmap', favoriteOnly: true, cursor, limit: 11 });
    expect(vars).toMatchObject({ ...owner, query: 'roadmap', favoriteOnly: true, cursor, limit: 11 });
  });

  test('filters semantic retrieval before cosine ranking and caps it to the requested current conversation limit', async () => {
    let query = ''; let vars: any;
    const database: any = { query: async (value: string, bind: unknown) => { query = value; vars = bind; return { next: async () => [] }; } };
    const repository = createConversationRepository(database);
    const owner = { organizationKey: 'organization', scopeKey: newId(), userKey: newId() }, conversationKey = newId();
    await repository.semanticMessages(owner, conversationKey, [1, 0], 50);
    for (const filter of ['message.conversationKey == conversation._key', 'message.organizationKey == @organizationKey', 'message.scopeKey == @scopeKey', 'message.userKey == @userKey', 'message.role == "ASSISTANT"', 'message.status == "COMPLETED"']) expect(query).toContain(filter);
    expect(query.indexOf('message.conversationKey')).toBeLessThan(query.indexOf('COSINE_SIMILARITY'));
    expect(vars).toMatchObject({ ...owner, conversationKey, limit: 50 });
  });

  test('declares transactional hard deletion of messages before the conversation', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source).toContain('transact(async (trx)');
    expect(source.indexOf('REMOVE message IN @@messages')).toBeLessThan(source.indexOf('REMOVE conversation IN @@conversations'));
    expect(source).not.toContain('deletedAt');
  });

  test('atomically claims the first turn and serializes a distinct pending turn', async () => {
    const user = turnMessage('USER'), assistant = turnMessage('ASSISTANT', { conversationKey: user.conversationKey, scopeKey: user.scopeKey, userKey: user.userKey });
    const inserts: string[] = []; let call = 0;
    const database: any = { query: async (query: string) => { call += 1; if (call === 1) return { next: async () => ({ existingUser: null, existingAssistant: null, active: null, first: true }) }; inserts.push(query); return { next: async () => raw(call === 2 ? user : assistant) }; } };
    const repository = createConversationRepository(database, (operation) => operation(database));
    expect(await repository.beginTurn({ organizationKey: user.organizationKey, scopeKey: user.scopeKey, userKey: user.userKey }, user.conversationKey, user, assistant)).toMatchObject({ state: 'created', first: true });
    expect(inserts).toHaveLength(2);

    const busyDb: any = { query: async () => ({ next: async () => ({ existingUser: null, existingAssistant: null, active: newId(), first: false }) }) };
    expect(await createConversationRepository(busyDb, (operation) => operation(busyDb)).beginTurn({ organizationKey: user.organizationKey, scopeKey: user.scopeKey, userKey: user.userKey }, user.conversationKey, user, assistant)).toEqual({ state: 'busy' });
  });

  test('turn unique-claim loser becomes a deterministic replay or payload conflict', async () => {
    const user = turnMessage('USER'), assistant = turnMessage('ASSISTANT', { conversationKey: user.conversationKey, scopeKey: user.scopeKey, userKey: user.userKey });
    let replayHash = user.requestHash;
    const database: any = { query: async () => ({ next: async () => ({ existingUser: raw({ ...user, requestHash: replayHash }), existingAssistant: raw({ ...assistant, requestHash: replayHash }), first: true }) }) };
    const uniqueLoser = async () => { throw { errorNum: 1210 }; };
    const repository = createConversationRepository(database, uniqueLoser);
    expect(await repository.beginTurn({ organizationKey: user.organizationKey, scopeKey: user.scopeKey, userKey: user.userKey }, user.conversationKey, user, assistant)).toMatchObject({ state: 'replay', first: true });
    replayHash = 'b'.repeat(64);
    expect(await repository.beginTurn({ organizationKey: user.organizationKey, scopeKey: user.scopeKey, userKey: user.userKey }, user.conversationKey, user, assistant)).toEqual({ state: 'idempotency-conflict' });
  });

  test('conditionally applies first generated name without overwriting a rename', async () => {
    const assistant = turnMessage('ASSISTANT'); let query = ''; let bindings: any;
    const database: any = { query: async (value: string, bind: unknown) => { query = value; bindings = bind; return { next: async () => ({ completed: raw({ ...assistant, status: 'COMPLETED', content: 'answer', completedAt: timestamp }), nameApplied: false }) }; } };
    const repository = createConversationRepository(database, (operation) => operation(database));
    const result = await repository.completeTurn({ organizationKey: assistant.organizationKey, scopeKey: assistant.scopeKey, userKey: assistant.userKey }, assistant.conversationKey, assistant.key, 'answer', [1], timestamp, 'Generated name');
    expect(result).toMatchObject({ nameApplied: false, message: { content: 'answer' } });
    expect(query).toContain('conversation.name == @defaultName'); expect(query).toContain('priorCompleted == 0');
    expect(bindings.defaultName).toBe('New chat');
  });
});
