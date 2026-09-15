import { describe, expect, test } from 'bun:test';
import {
  CONVERSATION_ARCHIVE_SUMMARY_INPUT_CHARACTERS,
  conversationArchiveKey,
  conversationArchiveKeys,
  createConversationArchiveProjectionRepository,
  prepareConversationArchiveProjection,
  summarizeConversationArchive,
  type ConversationArchiveSnapshot,
} from './archive-projection';
import { initialWorkspaceFolderKey } from '@/lib/initial-workspace-content-identifiers';
import { conversationMessageSchema, conversationSchema, type ConversationMessage } from './schemas';

const conversationKey = 'cm12345678901234567890123';
const scopeKey = 'cs12345678901234567890123';
const userKey = 'cu12345678901234567890123';
const actorKey = 'ca12345678901234567890123';
const teamKey = 'team-1';
const timestamp = '2026-09-12T10:11:12.345Z';
const requestHash = 'a'.repeat(64);

function message(overrides: Partial<ConversationMessage> & Pick<ConversationMessage, 'key' | 'role' | 'content'>): ConversationMessage {
  return conversationMessageSchema.parse({
    conversationKey, teamKey, scopeKey, userKey, turnKey: `turn-${overrides.key}`, requestHash,
    type: 'TEXT', status: 'COMPLETED', attachments: [], retrievals: [], createdAt: timestamp, completedAt: timestamp,
    ...overrides,
  });
}

const userMessage = message({ key: 'cum1234567890123456789012', role: 'USER', content: 'Necesito un plan exacto.' });
const assistantImage = message({ key: 'cim1234567890123456789012', role: 'ASSISTANT', type: 'IMAGE', content: '{"prompt":"not archive content"}', imageKey: 'cii1234567890123456789012', imageSummaryText: 'Una ilustración azul terminada.' });

function snapshot(messages = [userMessage, assistantImage]): ConversationArchiveSnapshot {
  return {
    state: { key: conversationArchiveKey('state', conversationKey), conversationKey, teamKey, scopeKey, userKey, actorKey, desiredRevision: 3, projectedRevision: 2, createdAt: timestamp, updatedAt: timestamp },
    conversation: conversationSchema.parse({ key: conversationKey, teamKey, scopeKey, userKey, name: 'Diseño', isFavorite: false, createdAt: timestamp, updatedAt: timestamp }),
    messages,
    existing: { folders: [], documents: [] },
  };
}

describe('conversation Archive projection', () => {
  test('creates stable cuid-shaped keys isolated by user and message identity', () => {
    const first = conversationArchiveKeys({ conversationKey, scopeKey, userKey });
    const again = conversationArchiveKeys({ conversationKey, scopeKey, userKey });
    const otherUser = conversationArchiveKeys({ conversationKey, scopeKey, userKey: 'co12345678901234567890123' });
    expect(first).toMatchObject(again);
    expect(first.rootFolderKey).toMatch(/^c[a-f0-9]{24}$/);
    expect(first.rootFolderKey).not.toBe(otherUser.rootFolderKey);
    expect(first.messageDocumentKey(userMessage.key)).not.toBe(first.messageDocumentKey(assistantImage.key));
  });

  test('prepares the private visible hierarchy and exact message documents without storage or versions', async () => {
    const embedded: string[] = [];
    const projection = await prepareConversationArchiveProjection(snapshot(), 'Resumen actual.', {
      embedTexts: async (texts) => { embedded.push(...texts); return texts.map((_, index) => [index + 1]); },
      now: () => timestamp,
    });
    const keys = conversationArchiveKeys({ conversationKey, scopeKey, userKey });
    expect(projection.folders.map(({ name, parentFolderKey, managedPurpose }) => ({ name, parentFolderKey, managedPurpose }))).toEqual([
      { name: 'Chats', parentFolderKey: initialWorkspaceFolderKey(scopeKey, 'assistant'), managedPurpose: 'conversation-root' },
      { name: 'Diseño', parentFolderKey: keys.rootFolderKey, managedPurpose: 'conversation' },
      { name: 'Summaries', parentFolderKey: keys.conversationFolderKey, managedPurpose: 'conversation-summaries' },
    ]);
    expect(projection.folders.every((folder) => folder.privateOwnerUserKey === userKey && folder.mutationPolicy === 'system-container' && folder.archiveVisibility === 'visible')).toBe(true);
    const documents = Object.fromEntries(projection.documents.map((document) => [document.key, document]));
    expect(documents[keys.messageDocumentKey(userMessage.key)]).toMatchObject({ name: '2026-09-12 10:11:12.345 UTC - User', content: userMessage.content, managedPurpose: 'conversation-message' });
    expect(documents[keys.messageDocumentKey(assistantImage.key)]).toMatchObject({ name: '2026-09-12 10:11:12.345 UTC - Core', content: assistantImage.imageSummaryText, managedPurpose: 'conversation-message' });
    expect(documents[keys.summaryDocumentKey]).toMatchObject({ name: 'Current summary', content: 'Resumen actual.', managedPurpose: 'conversation-summary' });
    expect(projection.documents.every((document) => document.privateOwnerUserKey === userKey && document.mutationPolicy === 'system-only' && document.archiveVisibility === 'visible' && !('storageKey' in document) && !('currentVersionKey' in document))).toBe(true);
    expect(embedded.some((text) => text.includes('{"prompt"'))).toBe(false);
  });

  test('reuses unchanged standard embeddings and omits a summary before a user message exists', async () => {
    const initial = await prepareConversationArchiveProjection(snapshot([]), null, { embedTexts: async (texts) => texts.map(() => [1]), now: () => timestamp });
    let calls = 0;
    const reused = await prepareConversationArchiveProjection({ ...snapshot([]), existing: initial }, null, { embedTexts: async () => { calls += 1; return []; }, now: () => '2026-09-13T00:00:00.000Z' });
    expect(calls).toBe(0);
    expect(reused).toEqual(initial);
    expect(reused.documents).toEqual([]);
  });

  test('commits with exact Arango bind variables and advances the revision fence', async () => {
    const projection = await prepareConversationArchiveProjection(snapshot(), 'Resumen actual.', { embedTexts: async (texts) => texts.map(() => [1]), now: () => timestamp });
    const database = { query: async (query: string, bindings: Record<string, unknown> = {}) => {
      for (const key of Object.keys(bindings)) expect(query).toContain(key.startsWith('@') ? `@${key}` : `@${key}`);
      return { next: async () => true, all: async () => [] };
    } };
    const repository = createConversationArchiveProjectionRepository(database, (operation) => operation(database));

    await expect(repository.commit(snapshot(), projection, timestamp)).resolves.toEqual({ status: 'committed', projectedRevision: 3 });
  });

  test('recursively summarizes long authoritative transcripts with bounded strict requests', async () => {
    const long = message({ key: 'cl12345678901234567890123', role: 'ASSISTANT', content: 'detalle '.repeat(CONVERSATION_ARCHIVE_SUMMARY_INPUT_CHARACTERS) });
    const requests: Array<{ source: string; instruction: string }> = [];
    let call = 0;
    const summary = await summarizeConversationArchive([userMessage, long], teamKey, async (request) => {
      requests.push(request);
      call += 1;
      return call < 3 ? `segmento ${call}` : 'Resumen final en español.';
    });
    expect(summary).toBe('Resumen final en español.');
    expect(requests.length).toBeGreaterThan(2);
    expect(requests.every(({ source }) => source.length <= CONVERSATION_ARCHIVE_SUMMARY_INPUT_CHARACTERS)).toBe(true);
    expect(requests.every(({ instruction }) => instruction.includes('Necesito un plan exacto.'))).toBe(true);
  });
});
