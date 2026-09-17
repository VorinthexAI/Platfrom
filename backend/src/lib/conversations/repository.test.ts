import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { CONVERSATION_SEMANTIC_MINIMUM_COSINE_SIMILARITY, createConversationRepository } from './repository';
import { conversationMessageSchema, projectConversationMessage, type ConversationMessage } from './schemas';
import { EMBEDDING_DIMENSIONS, embeddingMetadata } from '@/lib/embeddings';

const timestamp = '2026-09-01T00:00:00.000Z';
const turnMessage = (role: 'USER' | 'ASSISTANT', overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({ key: newId(), conversationKey: newId(), teamKey: 'team', scopeKey: newId(), userKey: newId(), turnKey: 'request', requestHash: 'a'.repeat(64), type: 'TEXT', role, status: role === 'USER' ? 'COMPLETED' : 'PENDING', content: role === 'USER' ? 'question' : 'Pending', attachments: [], retrievals: [], createdAt: timestamp, ...(role === 'USER' ? { completedAt: timestamp } : {}), ...overrides, guideTopics: overrides.guideTopics ?? { status: 'NONE' }, attachmentStatus: overrides.attachmentStatus ?? (overrides.attachments?.length ? 'COMPLETED' : overrides.pendingAttachmentKeys?.length ? 'PENDING' : 'NONE') });
const raw = ({ key, ...value }: ConversationMessage) => ({ _key: key, ...value });

describe('conversation repository boundaries', () => {
  test('parses durable funding state without exposing it in public messages', () => {
    const message = conversationMessageSchema.parse({ ...turnMessage('ASSISTANT'), type: 'IMAGE', status: 'FAILED', completedAt: timestamp, fundingRequiredCode: 'OUTSTANDING_DEBT', fundingRequiredAcknowledgedAt: timestamp });
    expect(message).toMatchObject({ fundingRequiredCode: 'OUTSTANDING_DEBT', fundingRequiredAcknowledgedAt: timestamp });
    expect(projectConversationMessage(message)).not.toHaveProperty('fundingRequiredCode');
    expect(projectConversationMessage(message)).not.toHaveProperty('fundingRequiredAcknowledgedAt');
  });

  test('normalizes legacy attachment lifecycle and exposes status without pending keys', () => {
    const attachment = { key: newId(), kind: 'document' as const, filename: 'notes.txt', mimeType: 'text/plain' as const, sizeBytes: 3 };
    const pendingKey = newId();
    const { attachmentStatus: _noneStatus, ...legacyNoneInput } = turnMessage('USER');
    const { attachmentStatus: _completedStatus, ...legacyCompletedInput } = turnMessage('USER', { attachments: [attachment] });
    const { attachmentStatus: _pendingStatus, ...legacyPendingInput } = turnMessage('USER', { pendingAttachmentKeys: [pendingKey] });
    const legacyNone = conversationMessageSchema.parse(legacyNoneInput);
    const legacyCompleted = conversationMessageSchema.parse(legacyCompletedInput);
    const legacyPending = conversationMessageSchema.parse(legacyPendingInput);
    expect([legacyNone.attachmentStatus, legacyCompleted.attachmentStatus, legacyPending.attachmentStatus]).toEqual(['NONE', 'COMPLETED', 'PENDING']);
    expect(projectConversationMessage(legacyPending)).toMatchObject({ attachmentStatus: 'PENDING', attachments: [] });
    expect(projectConversationMessage(legacyPending)).not.toHaveProperty('pendingAttachmentKeys');
    const privateContext = conversationMessageSchema.parse({ ...turnMessage('USER', { pendingAttachmentKeys: [pendingKey] }), attachmentContext: [{ filename: 'notes.txt', content: 'private extracted text' }] });
    expect(projectConversationMessage(privateContext)).not.toHaveProperty('attachmentContext');
    expect(conversationMessageSchema.parse({ ...turnMessage('USER', { attachments: [attachment] }), attachmentStatus: 'PARTIAL' }).attachmentStatus).toBe('PARTIAL');
  });

  test('uses favorite-first stable cursor ordering and newest-first message scans', async () => {
    const queries: string[] = []; const bindings: any[] = [];
    const database: any = { query: async (value: string, bind: unknown) => { queries.push(value); bindings.push(bind); return { all: async () => [], next: async () => [] }; } };
    const repository = createConversationRepository(database); const owner = { teamKey: 'team', scopeKey: newId(), userKey: newId() };
    await repository.list(owner, { limit: 26, favoriteOnly: false });
    await repository.listMessages(owner, newId(), undefined, 26);
    expect(queries[0]).toContain('SORT conversation.isFavorite DESC, conversation.updatedAt DESC, conversation._key ASC');
    expect(queries[0]).toContain('message.role == "USER"');
    expect(queries[0]).toContain('FILTER !@favoriteOnly || conversation.isFavorite == true');
    expect(queries[0]).toContain('@cursor.updatedAt');
    expect(bindings[0]).toMatchObject({ '@messages': 'conversationMessages', favoriteOnly: false, cursor: null, limit: 26 });
    expect(queries[1]).toContain('SORT message.createdAt DESC, message._key DESC');
  });

  test('combines favorite-only filtering with a stable pagination cursor', async () => {
    let vars: any;
    const database: any = { query: async (_value: string, bind: unknown) => { vars = bind; return { all: async () => [] }; } };
    const repository = createConversationRepository(database), owner = { teamKey: 'team', scopeKey: newId(), userKey: newId() };
    const cursor = { favorite: true, updatedAt: timestamp, key: newId() };
    await repository.list(owner, { query: 'roadmap', favoriteOnly: true, cursor, limit: 11 });
    expect(vars).toMatchObject({ ...owner, query: 'roadmap', favoriteOnly: true, cursor, limit: 11 });
  });

  test('loads the latest 50 owned completed user and assistant messages chronologically', async () => {
    let query = ''; let vars: any;
    const owner = { teamKey: 'team', scopeKey: newId(), userKey: newId() }, conversationKey = newId();
    const older = turnMessage('USER', { conversationKey, ...owner, createdAt: '2026-08-31T23:59:00.000Z', completedAt: '2026-08-31T23:59:00.000Z' });
    const newer = turnMessage('ASSISTANT', { conversationKey, ...owner, status: 'COMPLETED', content: 'answer', createdAt: timestamp, completedAt: timestamp });
    const database: any = { query: async (value: string, bind: unknown) => { query = value; vars = bind; return { next: async () => [raw(newer), raw(older)] }; } };

    const messages = await createConversationRepository(database).latestCompletedMessages(owner, conversationKey, timestamp, 50);

    expect(messages?.map(({ key }) => key)).toEqual([older.key, newer.key]);
    for (const filter of ['conversation != null', 'conversation.teamKey == @teamKey', 'conversation.scopeKey == @scopeKey', 'conversation.userKey == @userKey', 'message.conversationKey == conversation._key', 'message.teamKey == @teamKey', 'message.scopeKey == @scopeKey', 'message.userKey == @userKey', 'message.role IN ["USER", "ASSISTANT"]', 'message.status == "COMPLETED"']) expect(query).toContain(filter);
    expect(query).toContain('SORT message.createdAt DESC, message.turnKey DESC, message.role ASC, message._key DESC LIMIT @limit');
    expect(query).toContain('message.createdAt < @before');
    expect(vars).toEqual({ '@conversations': 'conversations', '@messages': 'conversationMessages', ...owner, conversationKey, before: timestamp, limit: 50 });
    expect(query).not.toContain('message.type == "TEXT"');
  });

  test('retrieves both completed roles scope-wide only through existing same-owner conversations', async () => {
    let query = ''; let vars: any;
    const owner = { teamKey: 'team', scopeKey: newId(), userKey: newId() };
    const vector = Array(EMBEDDING_DIMENSIONS).fill(0.1), excludedKeys = [newId(), newId()];
    const user = turnMessage('USER', { ...owner, status: 'COMPLETED', embedding: vector });
    const assistant = turnMessage('ASSISTANT', { ...owner, status: 'COMPLETED', content: 'answer', completedAt: timestamp, embedding: vector });
    const database: any = { query: async (value: string, bind: unknown) => { query = value; vars = bind; return { all: async () => [{ message: raw(user), similarity: 1 }, { message: raw(assistant), similarity: 0.9 }] }; } };

    const rows = await createConversationRepository(database).semanticMessages(owner, vector, { before: timestamp, excludedKeys, limit: 25 });

    expect(rows.map(({ message, similarity }) => ({ role: message.role, similarity }))).toEqual([{ role: 'USER', similarity: 1 }, { role: 'ASSISTANT', similarity: 0.9 }]);
    for (const filter of ['message.teamKey == @teamKey', 'message.scopeKey == @scopeKey', 'message.userKey == @userKey', 'message.role IN ["USER", "ASSISTANT"]', 'message.status == "COMPLETED"', 'message.createdAt < @before', '!POSITION(@excludedKeys, message._key)', 'IS_ARRAY(message.embedding)', 'LENGTH(message.embedding) == @dimensions', 'conversation != null', 'conversation.teamKey == @teamKey', 'conversation.scopeKey == @scopeKey', 'conversation.userKey == @userKey', 'message.conversationKey == conversation._key']) expect(query).toContain(filter);
    expect(query).toContain('LET conversation = DOCUMENT(@@conversations, message.conversationKey)');
    expect(query.indexOf('conversation != null')).toBeLessThan(query.indexOf('COSINE_SIMILARITY'));
    expect(query).toContain('SORT similarity DESC, message.createdAt DESC, message._key DESC LIMIT @limit');
    expect(query).not.toContain('@conversationKey');
    expect(query).toContain('message.embeddingProvider == @embeddingProvider');
    expect(query).toContain('message.embeddingModel == @embeddingModel');
    expect(query).toContain('message.embeddingDimensions == @dimensions');
    expect(query).toContain('similarity >= @minimumSimilarity');
    expect(vars).toEqual({ '@conversations': 'conversations', '@messages': 'conversationMessages', ...owner, embedding: vector, dimensions: EMBEDDING_DIMENSIONS, embeddingProvider: embeddingMetadata().embeddingProvider, embeddingModel: embeddingMetadata().embeddingModel, minimumSimilarity: CONVERSATION_SEMANTIC_MINIMUM_COSINE_SIMILARITY, before: timestamp, excludedKeys, limit: 20 });
  });

  test('reads only the deterministic current summary owned by the conversation user', async () => {
    let query = ''; let vars: any;
    const owner = { teamKey: 'team', scopeKey: newId(), userKey: newId() }, conversationKey = newId();
    const database: any = { query: async (value: string, bind: unknown) => { query = value; vars = bind; return { next: async () => 'Owned rolling summary' }; } };

    await expect(createConversationRepository(database).readArchiveSummary!(owner, conversationKey)).resolves.toBe('Owned rolling summary');

    for (const filter of ['conversation != null', 'conversation.teamKey == @teamKey', 'conversation.scopeKey == @scopeKey', 'conversation.userKey == @userKey', 'summary.privateOwnerUserKey == @userKey', 'summary.managedPurpose == "conversation-summary"', 'summary.managedOwnerKey == conversation._key', 'summary.mutationPolicy == "system-only"']) expect(query).toContain(filter);
    expect(vars).toMatchObject({ '@conversations': 'conversations', '@documents': 'documents', ...owner, conversationKey });
    expect(vars.summaryKey).toBeString();
  });

  test('self-heals missing Archive projection state with the authorized actor', async () => {
    let query = ''; let vars: any;
    const owner = { teamKey: 'team', scopeKey: newId(), userKey: newId() }, conversationKey = newId(), actorKey = newId();
    const state = { _key: conversationKey, conversationKey, ...owner, actorKey, desiredRevision: 1, projectedRevision: 0, createdAt: timestamp, updatedAt: timestamp };
    const database: any = { query: async (value: string, bind: unknown) => { query = value; vars = bind; return { next: async () => state }; } };

    await expect(createConversationRepository(database).requestArchiveProjection!(owner, conversationKey, timestamp, actorKey)).resolves.toMatchObject({ key: conversationKey, actorKey, desiredRevision: 1 });

    expect(query).toContain('UPSERT { _key: conversation._key }');
    expect(query).toContain('desiredRevision: 1, projectedRevision: 0');
    expect(query).toContain('desiredRevision: OLD.desiredRevision + 1');
    expect(query).toContain('conversation.name != @defaultName');
    expect(vars.defaultName).toBe('New chat');
    expect(vars).toMatchObject({ ...owner, conversationKey, actorKey, updatedAt: timestamp });
  });

  test('stores a completed message embedding only through its owned conversation', async () => {
    let query = ''; let vars: any;
    const owner = { teamKey: 'team', scopeKey: newId(), userKey: newId() };
    const database: any = { query: async (value: string, bind: unknown) => { query = value; vars = bind; return { next: async () => true }; } };
    const vector = Array(EMBEDDING_DIMENSIONS).fill(0.1);
    expect(await createConversationRepository(database).setMessageEmbedding(owner, newId(), newId(), vector)).toBe(true);
    for (const filter of ['conversation != null', 'conversation.teamKey == @teamKey', 'conversation.scopeKey == @scopeKey', 'conversation.userKey == @userKey', 'message.conversationKey == conversation._key', 'message.teamKey == @teamKey', 'message.scopeKey == @scopeKey', 'message.userKey == @userKey', 'message.status == "COMPLETED"']) expect(query).toContain(filter);
    expect(vars).toMatchObject({ ...owner, embedding: vector, metadata: embeddingMetadata() });
    expect(query).toContain('MERGE({ embedding: @embedding }, @metadata)');
  });

  test('binds both collections when recovering pending image turns', async () => {
    let query = ''; let vars: any;
    const database: any = { query: async (value: string, bind: unknown) => { query = value; vars = bind; return { all: async () => [] }; } };

    await createConversationRepository(database).listPendingImageTurns();

    expect(query).toContain('DOCUMENT(@@conversations, message.conversationKey)');
    expect(vars).toEqual({ '@conversations': 'conversations', '@messages': 'conversationMessages' });
  });

  test('durably records the terminal funding reason on an owned pending assistant turn', async () => {
    let query = ''; let vars: any;
    const owner = { teamKey: 'team', scopeKey: newId(), userKey: newId() };
    const database: any = { query: async (value: string, bind: unknown) => { query = value; vars = bind; return { next: async () => undefined }; } };
    await createConversationRepository(database).failTurn(owner, newId(), newId(), timestamp, 'OUTSTANDING_DEBT');
    expect(query).toContain('fundingRequiredCode: @fundingRequiredCode');
    expect(query).toContain('message._key == selected._key ||');
    expect(query).toContain('fundingRequiredAcknowledgedAt: @completedAt');
    expect(query).not.toContain('fundingRequiredAcknowledgedAt: null');
    expect(vars).toMatchObject({ ...owner, completedAt: timestamp, fundingRequiredCode: 'OUTSTANDING_DEBT' });
  });

  test('declares transactional hard deletion of messages before the conversation', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source).toContain('transact(async (trx)');
    expect(source).toContain('artifact.conversationKey == conversation._key');
    expect(source).toContain('UPSERT { storageKey }');
    expect(source).toContain('UNIQUE(FOR artifact IN artifacts');
    expect(source).toContain('CONVERSATION_DELETE_WRITE');
    expect(source).toContain('exclusive: []');
    expect(source).toContain('IS_STRING(artifact.stagedStorageKey)');
    expect(source.indexOf('REMOVE artifact IN @@artifacts')).toBeLessThan(source.indexOf('REMOVE conversation IN @@conversations'));
    expect(source.indexOf('REMOVE message IN @@messages')).toBeLessThan(source.indexOf('REMOVE conversation IN @@conversations'));
    expect(source).not.toContain('deletedAt');
    expect(source).toContain('REMOVE state IN @@states');
    expect(source).not.toContain('REMOVE folder IN @@folders');
    expect(source).not.toContain('REMOVE root IN @@folders');
  });

  test('hard-deletes the owned paired turn selected by either message', async () => {
    let query = ''; let vars: any;
    const owner = { teamKey: 'team', scopeKey: newId(), userKey: newId() }, conversationKey = newId(), messageKey = newId(), deletedKeys = [messageKey, newId()];
    const database: any = { query: async (value: string, bind: unknown) => { query = value; vars = bind; return { next: async () => deletedKeys }; } };
    await expect(createConversationRepository(database, (operation) => operation(database)).deleteMessageTurn(owner, conversationKey, messageKey, timestamp)).resolves.toEqual(deletedKeys);
    for (const filter of ['conversation != null', 'selected != null', 'selected.conversationKey == conversation._key', 'selected.teamKey == @teamKey', 'message.turnKey == selected.turnKey', 'message.status == "PENDING"', 'REMOVE message IN @@messages']) expect(query).toContain(filter);
    expect(query).toContain('UPDATE conversation WITH { updatedAt: @updatedAt }');
    expect(query).toContain('REMOVE artifact IN @@artifacts');
    expect(query).toContain('REMOVE document IN @@documents');
    expect(query.indexOf('REMOVE document IN @@documents')).toBeLessThan(query.indexOf('REMOVE message IN @@messages'));
    expect(query).toContain('UPSERT { storageKey }');
    expect(query).toContain('IS_STRING(artifact.stagedStorageKey)');
    expect(query).toContain('artifact._key NOT IN retainedArtifactKeys');
    expect(vars).toEqual({ '@conversations': 'conversations', '@messages': 'conversationMessages', '@artifacts': 'conversationAttachmentArtifacts', '@storageJobs': 'storageDeletionJobs', '@documents': 'documents', ...owner, conversationKey, messageKey, updatedAt: timestamp });
  });

  test('atomically claims the first turn and serializes a distinct pending turn', async () => {
    const user = turnMessage('USER'), assistant = turnMessage('ASSISTANT', { conversationKey: user.conversationKey, scopeKey: user.scopeKey, userKey: user.userKey });
    const inserts: string[] = []; let call = 0;
    const database: any = { query: async (query: string) => { call += 1; if (call === 1) return { next: async () => ({ existingUser: null, existingAssistant: null, active: null, first: true }) }; inserts.push(query); return { next: async () => raw(call === 2 ? user : assistant) }; } };
    const repository = createConversationRepository(database, (operation) => operation(database));
    expect(await repository.beginTurn({ teamKey: user.teamKey, scopeKey: user.scopeKey, userKey: user.userKey }, user.conversationKey, user, assistant)).toMatchObject({ state: 'created', first: true });
    expect(inserts).toHaveLength(3);

    const busyDb: any = { query: async () => ({ next: async () => ({ existingUser: null, existingAssistant: null, active: newId(), first: false }) }) };
    expect(await createConversationRepository(busyDb, (operation) => operation(busyDb)).beginTurn({ teamKey: user.teamKey, scopeKey: user.scopeKey, userKey: user.userKey }, user.conversationKey, user, assistant)).toEqual({ state: 'busy' });
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source).toContain('message.type == "TEXT" && message.role == "ASSISTANT" && message.status == "PENDING"');
  });

  test('claims every prepared artifact in the message transaction and replay never reclaims', async () => {
    const keys = [newId(), newId()];
    const user = turnMessage('USER', { pendingAttachmentKeys: keys, attachmentStatus: 'PENDING' });
    const assistant = turnMessage('ASSISTANT', { conversationKey: user.conversationKey, scopeKey: user.scopeKey, userKey: user.userKey });
    let calls = 0;
    const conflictDb: any = { query: async (query: string) => { calls += 1; if (calls === 1) return { next: async () => ({ existingUser: null, existingAssistant: null, active: null, first: true }) }; expect(query).toContain('artifact.status == "PREPARED"'); return { all: async () => [keys[0]] }; } };
    await expect(createConversationRepository(conflictDb, (operation) => operation(conflictDb)).beginTurn({ teamKey: user.teamKey, scopeKey: user.scopeKey, userKey: user.userKey }, user.conversationKey, user, assistant, newId())).resolves.toEqual({ state: 'attachment-conflict' });
    expect(calls).toBe(2);

    calls = 0;
    const replayDb: any = { query: async () => { calls += 1; return { next: async () => ({ existingUser: raw(user), existingAssistant: raw(assistant), active: null, first: true }) }; } };
    await expect(createConversationRepository(replayDb, (operation) => operation(replayDb)).beginTurn({ teamKey: user.teamKey, scopeKey: user.scopeKey, userKey: user.userKey }, user.conversationKey, user, assistant, newId())).resolves.toMatchObject({ state: 'replay' });
    expect(calls).toBe(1);
  });

  test('turn unique-claim loser becomes a deterministic replay or payload conflict', async () => {
    const user = turnMessage('USER'), assistant = turnMessage('ASSISTANT', { conversationKey: user.conversationKey, scopeKey: user.scopeKey, userKey: user.userKey });
    let replayHash = user.requestHash;
    const database: any = { query: async () => ({ next: async () => ({ existingUser: raw({ ...user, requestHash: replayHash }), existingAssistant: raw({ ...assistant, requestHash: replayHash }), first: true }) }) };
    const uniqueLoser = async () => { throw { errorNum: 1210 }; };
    const repository = createConversationRepository(database, uniqueLoser);
    expect(await repository.beginTurn({ teamKey: user.teamKey, scopeKey: user.scopeKey, userKey: user.userKey }, user.conversationKey, user, assistant)).toMatchObject({ state: 'replay', first: true });
    replayHash = 'b'.repeat(64);
    expect(await repository.beginTurn({ teamKey: user.teamKey, scopeKey: user.scopeKey, userKey: user.userKey }, user.conversationKey, user, assistant)).toEqual({ state: 'idempotency-conflict' });
  });

  test('conditionally applies first generated name without overwriting a rename', async () => {
    const assistant = turnMessage('ASSISTANT'); let query = ''; let bindings: any; let transactions = 0;
    const database: any = { query: async (value: string, bind: unknown) => { query = value; bindings = bind; return { next: async () => ({ completed: raw({ ...assistant, status: 'COMPLETED', content: 'answer', completedAt: timestamp }), nameApplied: false }) }; } };
    const repository = createConversationRepository(database, (operation) => { transactions += 1; return operation(database); });
    const retrievals = [{ query: 'roadmap', limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: 'documents' as const, results: [{ key: newId(), label: 'Roadmap' }] }] }];
    const result = await repository.completeTurn({ teamKey: assistant.teamKey, scopeKey: assistant.scopeKey, userKey: assistant.userKey }, assistant.conversationKey, assistant.key, 'answer', [1], retrievals, timestamp, 'Generated name');
    expect(result).toMatchObject({ nameApplied: false, message: { content: 'answer' } });
    expect(query).toContain('conversation.name == @defaultName'); expect(query).toContain('userTurns == 1');
    expect(query).toContain('other.role == "USER"');
    expect(query).toContain('retrievals: @retrievals'); expect(bindings.retrievals).toEqual(retrievals);
    expect(query).not.toContain('paths: @paths'); expect(bindings).not.toHaveProperty('paths');
    expect(bindings.defaultName).toBe('New chat');
    expect(transactions).toBe(0);
  });

  test('validates selected topics and persists their trusted guide mode inside beginTurn', async () => {
    const user = turnMessage('USER', { content: 'How does Archive work?' }), assistant = turnMessage('ASSISTANT', { conversationKey: user.conversationKey, scopeKey: user.scopeKey, userKey: user.userKey });
    const queries: string[] = []; let insertedUser: any;
    const database: any = { query: async (query: string, vars: any) => {
      queries.push(query);
      if (queries.length === 1) return { next: async () => ({ existingUser: null, existingAssistant: null, active: null, first: false, selectionValid: true, selectedGuideMode: 'explain' }) };
      if (query.includes('INSERT @user')) { insertedUser = vars.user; return { next: async () => ({ ...vars.user, _key: vars.user._key }) }; }
      if (query.includes('INSERT @assistant')) return { next: async () => ({ ...vars.assistant, _key: vars.assistant._key }) };
      return { next: async () => undefined };
    } };
    const selection = { sourceAssistantMessageKey: newId(), topicKey: newId() };
    const result = await createConversationRepository(database, (operation) => operation(database)).beginTurn({ teamKey: user.teamKey, scopeKey: user.scopeKey, userKey: user.userKey }, user.conversationKey, user, assistant, undefined, selection);
    expect(result).toMatchObject({ state: 'created', user: { selectedGuideMode: 'explain' } });
    expect(insertedUser.selectedGuideMode).toBe('explain');
    for (const text of ['selectedSource.conversationKey == conversation._key', 'selectedSource.guideTopics.status == "READY"', 'TO_ARRAY(selectedSource.guideTopics.topics)', 'topic.question == @message', 'selectedSource._key == latestAssistant._key']) expect(queries[0]).toContain(text);
    expect(queries[1]).toContain('guideTopics.status == "PENDING"');

    const invalidDb: any = { query: async () => ({ next: async () => ({ existingUser: null, existingAssistant: null, active: null, first: false, selectionValid: false, selectedGuideMode: null }) }) };
    await expect(createConversationRepository(invalidDb, (operation) => operation(invalidDb)).beginTurn({ teamKey: user.teamKey, scopeKey: user.scopeKey, userKey: user.userKey }, user.conversationKey, user, assistant, undefined, selection)).resolves.toEqual({ state: 'guide-selection-conflict' });
  });

  test('validates a READY topic from any owned completed assistant message', async () => {
    let query = ''; let vars: any;
    const owner = { teamKey: 'team', scopeKey: newId(), userKey: newId() }, conversationKey = newId();
    const selection = { sourceAssistantMessageKey: newId(), topicKey: 'greeting.explain.archive' };
    const database: any = { query: async (value: string, bindings: unknown) => { query = value; vars = bindings; return { next: async () => 'explain' }; } };
    await expect(createConversationRepository(database).validateGuideTopicSelection(owner, conversationKey, selection, 'How does Archive work?')).resolves.toBe('explain');
    for (const condition of ['source.conversationKey == conversation._key', 'source.teamKey == @teamKey', 'source.scopeKey == @scopeKey', 'source.userKey == @userKey', 'source.guideTopics.status == "READY"', 'item.question == @message']) expect(query).toContain(condition);
    expect(query).not.toContain('latestAssistant');
    expect(vars).toMatchObject({ ...owner, conversationKey, sourceAssistantMessageKey: selection.sourceAssistantMessageKey, topicKey: selection.topicKey, message: 'How does Archive work?' });
  });

  test('stores AI-written image status separately from private generation input', async () => {
    const assistant = turnMessage('ASSISTANT', { type: 'IMAGE', status: 'PENDING', content: '{"prompt":"private"}', completedAt: undefined }); let query = ''; let bindings: any;
    const database: any = { query: async (value: string, bind: any) => { query = value; bindings = bind; return { next: async () => raw({ ...assistant, imageStatusText: bind.statusText }) }; } };
    const result = await createConversationRepository(database, (operation) => operation(database)).setImageStatusText({ teamKey: assistant.teamKey, scopeKey: assistant.scopeKey, userKey: assistant.userKey }, assistant.conversationKey, assistant.key, 'I am creating your image now.');
    expect(result?.imageStatusText).toBe('I am creating your image now.');
    expect(query).toContain('message.type == "IMAGE"');
    expect(bindings.statusText).not.toContain('private');
  });

  test('completes the originating image message with its image summary', async () => {
    const assistant = turnMessage('ASSISTANT', { type: 'IMAGE', status: 'PENDING', content: '{"prompt":"private"}', imageStatusText: 'I am creating a horse.', completedAt: undefined });
    const imageKey = newId(); let query = ''; let bindings: any;
    const database: any = { query: async (value: string, bind: any) => { query = value; bindings = bind; return { next: async () => raw({ ...assistant, imageKey, imageSummaryText: bind.summaryText, status: 'COMPLETED', completedAt: bind.completedAt }) }; } };
    const result = await createConversationRepository(database, (operation) => operation(database)).completeImageTurn({ teamKey: assistant.teamKey, scopeKey: assistant.scopeKey, userKey: assistant.userKey }, assistant.conversationKey, assistant.key, imageKey, 'A white horse in a field.', timestamp);
    expect(result).toMatchObject({ key: assistant.key, imageKey, imageSummaryText: 'A white horse in a field.' });
    expect(query).toContain('DOCUMENT(@@messages, @assistantKey)');
    expect(query).toContain('imageSummaryText: @summaryText');
    expect(bindings.assistantKey).toBe(assistant.key);
  });
});
