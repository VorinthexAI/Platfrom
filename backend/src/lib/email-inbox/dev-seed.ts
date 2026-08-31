import { createHash } from 'node:crypto';
import { toArangoDoc } from '@/lib/db/base';
import { archiveDocument, emailDraftPayloadSchema, emailMessagePayloadSchema, emailReplyContextPayloadSchema, emailThreadPayloadSchema, emailTonePayloadSchema, encodeEmailToneContent, prepareEmailReplyContextDocument, prepareEmailToneDocument } from './archive-payloads';
import { organizationConnectorSchema } from './connector-schema';
import { inboxSchema } from './inbox-schema';
import { emailInboxKey } from './inbox-key';
import { MAIL_DEV_FIXTURE_AT, MAIL_DEV_FIXTURE_PREFIX, mailDevFixtures } from './dev-fixtures';
import { emailDevelopmentAttachmentAssets } from '@/lib/development-fixture-assets';
import { emailDraftRecordSchema, emailMessageRecordSchema, emailReplyContextRecordSchema, emailThreadRecordSchema, emailToneRecordSchema } from '@/lib/db/email-records.node';

export function mailDevFixtureKey(kind: string, ...values: string[]) {
  return `c${createHash('sha256').update([kind, ...values].join('\0')).digest('hex').slice(0, 24)}`;
}

function withoutArchiveFields<T extends { scopeKey: string; embedding: number[] }>(value: T) {
  const { scopeKey: _scopeKey, embedding: _embedding, ...data } = value;
  return data;
}

export function assertLocalMailSeedEnvironment(environment: Partial<Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'ARANGO_URL'>>) {
  if (environment.NODE_ENV?.trim().toLowerCase() === 'production') throw new Error('Mail development seed is disabled in production.');
  if (!environment.ARANGO_URL) throw new Error('Mail development seed requires ARANGO_URL.');
  let url: URL;
  try { url = new URL(environment.ARANGO_URL); } catch { throw new Error('Mail development seed requires a valid local ArangoDB URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !hasExplicitLoopbackHostname(environment.ARANGO_URL)) throw new Error('Mail development seed requires an explicit loopback ArangoDB host.');
  return url;
}

function hasExplicitLoopbackHostname(value: string) {
  const match = /^https?:\/\/(\[[^\]]+\]|[^:/?#]+)(?::\d+)?(?:[/?#]|$)/i.exec(value);
  if (!match) return false;
  const hostname = match[1]!.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname === '::1') return true;
  const octets = hostname.split('.');
  return octets.length === 4 && octets[0] === '127' && octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255);
}

type FixtureCredentials = { encryptedCredentials: string; encryptionKeyId: string; accessTokenFingerprint: string };

export function buildMailDevSeedManifest(input: {
  organizationKey: string;
  scopeKey: string;
  membershipKey: string;
  credentials: (accountKey: string, providerAccountId: string) => FixtureCredentials;
}) {
  const accountKeys = ['studio', 'personal', 'community'].map((slug) => mailDevFixtureKey('mail-dev-connector', input.scopeKey, slug));
  const fixtures = mailDevFixtures(input.scopeKey, accountKeys);
  const attachmentAssets = emailDevelopmentAttachmentAssets(input.scopeKey);
  const folders = {
    root: mailDevFixtureKey('email-archive-export-root', input.scopeKey),
    drafts: mailDevFixtureKey('email-archive-drafts-export', input.scopeKey),
    tones: mailDevFixtureKey('email-archive-tones-export', input.scopeKey),
    replyContext: mailDevFixtureKey('email-archive-reply-context-export', input.scopeKey),
  };
  const connectors = fixtures.accounts.map((account) => {
    const providerAccountId = `${MAIL_DEV_FIXTURE_PREFIX}:${account.slug}`;
    return organizationConnectorSchema.parse({
    key: account.accountKey,
    organizationKey: input.organizationKey,
    scopeKey: input.scopeKey,
    provider: 'gmail',
    providerAccountId,
    email: account.email,
    ...input.credentials(account.accountKey, providerAccountId),
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    createdByMembershipKey: input.membershipKey,
    status: 'error',
    syncEnabled: false,
    initialSyncCompleted: true,
    syncStatus: 'idle',
    syncError: 'Local fixture connector; provider access is disabled.',
    lastError: 'Local fixture connector; provider access is disabled.',
    createdAt: MAIL_DEV_FIXTURE_AT,
    updatedAt: MAIL_DEV_FIXTURE_AT,
    });
  });
  const inboxes = fixtures.accounts.map((account, index) => inboxSchema.parse({
    key: emailInboxKey(input.scopeKey, account.accountKey),
    organizationKey: input.organizationKey,
    scopeKey: input.scopeKey,
    connectorKey: account.accountKey,
    name: account.name,
    description: account.description,
    isFavorite: index === 0,
    embedding: fixtures.threads[index * 9]!.thread.embedding,
    createdAt: MAIL_DEV_FIXTURE_AT,
    updatedAt: MAIL_DEV_FIXTURE_AT,
  }));
  const exportFolders: Array<Record<string, unknown>> = [{
    _key: folders.root, scopeKey: input.scopeKey, name: 'Signal', presentation: 'communication', mutationPolicy: 'user', embedding: fixtures.threads[0]!.thread.embedding, isFavorite: false, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT,
  }, ...([['drafts', 'Drafts'], ['tones', 'Tones'], ['replyContext', 'Reply context']] as const).map(([kind, name]) => ({
    _key: folders[kind], scopeKey: input.scopeKey, parentFolderKey: folders.root, name, mutationPolicy: 'user', embedding: fixtures.threads[0]!.thread.embedding, isFavorite: false, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT,
  })), ...inboxes.flatMap((inbox) => [{
    _key: mailDevFixtureKey('email-archive-export-inbox', input.scopeKey, inbox.connectorKey), scopeKey: input.scopeKey, parentFolderKey: folders.root, name: inbox.name, description: inbox.description,
    mutationPolicy: 'user', embedding: inbox.embedding, isFavorite: inbox.isFavorite, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT,
  }, {
    _key: mailDevFixtureKey('email-archive-files-export', input.scopeKey, inbox.connectorKey), scopeKey: input.scopeKey, parentFolderKey: mailDevFixtureKey('email-archive-export-inbox', input.scopeKey, inbox.connectorKey), name: 'Files', description: 'Documents synchronized from email attachments',
    mutationPolicy: 'user', embedding: inbox.embedding, isFavorite: false, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT,
  }])];
  const emailThreads: Array<ReturnType<typeof emailThreadRecordSchema.parse>> = [];
  const emailMessages: Array<ReturnType<typeof emailMessageRecordSchema.parse>> = [];
  const emailDrafts: Array<ReturnType<typeof emailDraftRecordSchema.parse>> = [];
  const emailTones: Array<ReturnType<typeof emailToneRecordSchema.parse>> = [];
  const emailReplyContext: Array<ReturnType<typeof emailReplyContextRecordSchema.parse>> = [];
  const documents = fixtures.threads.flatMap(({ thread, messages }) => {
    const threadKey = mailDevFixtureKey('mail-thread', thread.scopeKey, thread.accountKey, thread.providerThreadId);
    emailThreads.push(emailThreadRecordSchema.parse({ ...thread, key: threadKey, developmentFixtureIdentifier: MAIL_DEV_FIXTURE_PREFIX, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT }));
    const threadPayload = emailThreadPayloadSchema.parse({ version: 1, kind: 'mail-thread', data: withoutArchiveFields(thread) });
    const threadDocument = archiveDocument({ key: mailDevFixtureKey('email-archive-thread-export', threadKey), scopeKey: input.scopeKey, folderKey: mailDevFixtureKey('email-archive-export-inbox', input.scopeKey, thread.accountKey), name: thread.subject, payload: threadPayload, embedding: thread.embedding, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT, mutationPolicy: 'user', developmentFixtureIdentifier: MAIL_DEV_FIXTURE_PREFIX });
    const messageDocuments = messages.map((message) => {
      const key = mailDevFixtureKey('mail-message', message.scopeKey, message.accountKey, message.providerMessageId);
      emailMessages.push(emailMessageRecordSchema.parse({ ...message, key, threadKey, developmentFixtureIdentifier: MAIL_DEV_FIXTURE_PREFIX, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT }));
      const payload = emailMessagePayloadSchema.parse({ version: 1, kind: 'mail-message', data: { ...withoutArchiveFields(message), threadKey } });
      return archiveDocument({ key: mailDevFixtureKey('email-archive-message-export', key), scopeKey: input.scopeKey, folderKey: mailDevFixtureKey('email-archive-export-inbox', input.scopeKey, message.accountKey), name: message.subject, payload, embedding: message.embedding, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT, mutationPolicy: 'user', developmentFixtureIdentifier: MAIL_DEV_FIXTURE_PREFIX });
    });
    return [threadDocument, ...messageDocuments];
  });
  for (const tone of fixtures.tones) {
    const slug = 'slug' in tone ? tone.slug : undefined;
    const key = slug ? mailDevFixtureKey('mail-tone', input.scopeKey, slug) : mailDevFixtureKey('mail-dev-tone', input.scopeKey, tone.id);
    const data = emailTonePayloadSchema.shape.data.parse({ ...(slug ? { slug } : { identifier: `${MAIL_DEV_FIXTURE_PREFIX}:${tone.id}` }), name: tone.name, instruction: tone.instruction });
    const embedding = fixtures.threads[fixtures.tones.indexOf(tone)]!.thread.embedding;
    const payload = emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data });
    const document = archiveDocument({ key: mailDevFixtureKey('mail-tone-export', input.scopeKey, key), scopeKey: input.scopeKey, folderKey: folders.tones, name: tone.name, payload, embedding, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT, mutationPolicy: 'user', developmentFixtureIdentifier: MAIL_DEV_FIXTURE_PREFIX });
    document.content = encodeEmailToneContent(data);
    document.isFavorite = tone.isFavorite;
    documents.push(prepareEmailToneDocument(document, data, embedding));
    emailTones.push(emailToneRecordSchema.parse({ ...data, key, scopeKey: input.scopeKey, embedding, isFavorite: tone.isFavorite, developmentFixtureIdentifier: MAIL_DEV_FIXTURE_PREFIX, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT }));
  }
  for (const note of fixtures.replyContext) {
    const key = mailDevFixtureKey('mail-dev-reply-context', input.scopeKey, note.id);
    const data = emailReplyContextPayloadSchema.shape.data.parse({ name: note.name, text: note.text });
    const embedding = fixtures.threads[fixtures.replyContext.indexOf(note) + 6]!.thread.embedding;
    const payload = emailReplyContextPayloadSchema.parse({ version: 1, kind: 'mail-reply-context', data });
    const document = archiveDocument({ key: mailDevFixtureKey('mail-reply-context-export', input.scopeKey, key), scopeKey: input.scopeKey, folderKey: folders.replyContext, name: note.name, payload, embedding, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT, mutationPolicy: 'user', developmentFixtureIdentifier: MAIL_DEV_FIXTURE_PREFIX });
    documents.push(prepareEmailReplyContextDocument(document, data, embedding));
    emailReplyContext.push(emailReplyContextRecordSchema.parse({ ...data, key, scopeKey: input.scopeKey, embedding, developmentFixtureIdentifier: MAIL_DEV_FIXTURE_PREFIX, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT }));
  }
  for (const draft of fixtures.drafts) {
    const key = mailDevFixtureKey('mail-dev-draft', input.scopeKey, draft.id);
    const thread = fixtures.threads.find(({ fixtureId }) => fixtureId === draft.threadFixtureId);
    const data = draft.variant === 'new'
      ? { variant: 'new' as const, accountKey: draft.accountKey, to: draft.to, ...('cc' in draft ? { cc: draft.cc } : {}), ...('bcc' in draft ? { bcc: draft.bcc } : {}), subject: draft.subject, generatedContent: draft.generatedContent, ...('finalContent' in draft ? { finalContent: draft.finalContent } : {}), status: draft.status, tone: draft.tone }
      : { variant: 'reply' as const, creationSource: 'subscription' as const, replyMode: draft.replyMode, threadKey: mailDevFixtureKey('mail-thread', input.scopeKey, draft.accountKey, draft.threadFixtureId), messageKey: mailDevFixtureKey('mail-message', input.scopeKey, draft.accountKey, draft.messageProviderId), to: draft.to, cc: draft.cc, generatedContent: draft.generatedContent, ...('finalContent' in draft ? { finalContent: draft.finalContent } : {}), status: draft.status, tone: draft.tone };
    if (draft.variant === 'reply' && !thread) throw new Error(`Fixture draft ${draft.id} has no thread.`);
    const kind = draft.variant === 'new' ? 'mail-new-draft' : 'mail-reply-draft';
    const payload = emailDraftPayloadSchema.parse({ version: 1, kind, data });
    const embedding = fixtures.threads[fixtures.drafts.indexOf(draft) + 12]!.thread.embedding;
    documents.push(archiveDocument({ key: mailDevFixtureKey('mail-draft-export', input.scopeKey, key), scopeKey: input.scopeKey, folderKey: folders.drafts, name: draft.variant === 'new' ? draft.subject : `Reply ${draft.threadFixtureId}`, payload, embedding, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT, mutationPolicy: 'user', developmentFixtureIdentifier: MAIL_DEV_FIXTURE_PREFIX }));
    emailDrafts.push(emailDraftRecordSchema.parse({ ...data, key, scopeKey: input.scopeKey, embedding, developmentFixtureIdentifier: MAIL_DEV_FIXTURE_PREFIX, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT }));
  }
  return { fixtures, connectors, inboxes, exportFolders, emailThreads, emailMessages, emailDrafts, emailTones, emailReplyContext, documents, accountKeys, attachmentAssets };
}

type SeedDatabase = { query(query: string, bindVars?: Record<string, unknown>): Promise<{ next(): Promise<unknown>; all(): Promise<unknown[]> }> };

export async function reconcileMailDevSeed(database: SeedDatabase, manifest: ReturnType<typeof buildMailDevSeedManifest>) {
  const persist = async (collection: string, values: unknown[], preserveCredentials = false) => {
    const cursor = await database.query(`FOR expected IN @values
      LET current = DOCUMENT(@@collection, expected._key)
      LET desired = @preserveCredentials && current != null ? MERGE(expected, { encryptedCredentials: current.encryptedCredentials, encryptionKeyId: current.encryptionKeyId, accessTokenFingerprint: current.accessTokenFingerprint }) : expected
      FILTER current == null || UNSET(current, "_id", "_rev") != desired
      UPSERT { _key: expected._key } INSERT desired REPLACE desired IN @@collection OPTIONS { keepNull: false }
      COLLECT WITH COUNT INTO changed RETURN changed`, { '@collection': collection, values, preserveCredentials });
    return Number(await cursor.next() ?? 0);
  };
  await persist('organizationConnectors', manifest.connectors.map(toArangoDoc), true);
  await persist('emailInboxes', manifest.inboxes.map(toArangoDoc));
  await persist('folders', manifest.exportFolders);
  await persist('emailThreads', manifest.emailThreads.map(toArangoDoc));
  await persist('emailMessages', manifest.emailMessages.map(toArangoDoc));
  await persist('emailDrafts', manifest.emailDrafts.map(toArangoDoc));
  await persist('emailTones', manifest.emailTones.map(toArangoDoc));
  await persist('emailReplyContext', manifest.emailReplyContext.map(toArangoDoc));
  await persist('documents', manifest.documents.map(toArangoDoc));
  await database.query(`LET fixtureConnectorKeys = (FOR connector IN organizationConnectors FILTER connector.scopeKey == @scopeKey && STARTS_WITH(connector.providerAccountId, @prefix) RETURN connector._key)
    LET staleConnectorKeys = MINUS(fixtureConnectorKeys, @keepConnectorKeys)
    LET removedInboxes = (FOR inbox IN emailInboxes FILTER inbox.scopeKey == @scopeKey && inbox.connectorKey IN staleConnectorKeys REMOVE inbox IN emailInboxes RETURN 1)
    FOR connector IN organizationConnectors FILTER connector._key IN staleConnectorKeys REMOVE connector IN organizationConnectors`, { scopeKey: manifest.fixtures.threads[0]!.thread.scopeKey, prefix: MAIL_DEV_FIXTURE_PREFIX, keepConnectorKeys: manifest.connectors.map(({ key }) => key) });
  const keepDocumentKeys = manifest.documents.map(({ key }) => key);
  for (const [collection, keep] of [['emailThreads', manifest.emailThreads.map(({ key }) => key)], ['emailMessages', manifest.emailMessages.map(({ key }) => key)], ['emailDrafts', manifest.emailDrafts.map(({ key }) => key)], ['emailTones', manifest.emailTones.map(({ key }) => key)], ['emailReplyContext', manifest.emailReplyContext.map(({ key }) => key)]] as const) {
    await database.query('FOR value IN @@collection FILTER value.scopeKey == @scopeKey && value.developmentFixtureIdentifier == @prefix && value._key NOT IN @keep REMOVE value IN @@collection', { '@collection': collection, scopeKey: manifest.fixtures.threads[0]!.thread.scopeKey, prefix: MAIL_DEV_FIXTURE_PREFIX, keep });
  }
  await database.query(`FOR document IN documents
    FILTER document.scopeKey == @scopeKey && document._key NOT IN @keep
    LET payload = JSON_PARSE(document.content)
    FILTER document.developmentFixtureIdentifier == @prefix || (payload.kind == "mail-thread" && STARTS_WITH(payload.data.providerThreadId, @prefix)) || (payload.kind == "mail-message" && STARTS_WITH(payload.data.providerMessageId, @prefix)) || (payload.kind == "mail-tone" && STARTS_WITH(payload.data.identifier || "", @prefix)) || (CONTAINS(document.content, "<!-- vorinthex-mail-tone ") && CONTAINS(document.content, @toneIdentifierFragment))
    REMOVE document IN documents`, { scopeKey: manifest.fixtures.threads[0]!.thread.scopeKey, keep: keepDocumentKeys, prefix: MAIL_DEV_FIXTURE_PREFIX, toneIdentifierFragment: `"identifier":"${MAIL_DEV_FIXTURE_PREFIX}:` });
  await database.query('FOR folder IN folders FILTER folder.scopeKey == @scopeKey && folder._key NOT IN @keep FILTER (folder.managedPurpose == "mail-inbox" && folder.managedOwnerKey IN @connectorKeys) || folder.managedPurpose == "mail-thread" FILTER LENGTH(FOR document IN documents FILTER document.folderKey == folder._key LIMIT 1 RETURN 1) == 0 REMOVE folder IN folders', { scopeKey: manifest.fixtures.threads[0]!.thread.scopeKey, keep: manifest.exportFolders.map((folder) => folder._key), connectorKeys: manifest.connectors.map(({ key }) => key) });
}

export async function verifyMailDevSeed(database: SeedDatabase, manifest: ReturnType<typeof buildMailDevSeedManifest>) {
  const cursor = await database.query(`LET connectorMismatches = (FOR expected IN @connectors
      LET current = DOCUMENT(organizationConnectors, expected._key)
      LET desired = current == null ? expected : MERGE(expected, { encryptedCredentials: current.encryptedCredentials, encryptionKeyId: current.encryptionKeyId, accessTokenFingerprint: current.accessTokenFingerprint })
      FILTER current == null || UNSET(current, "_id", "_rev") != desired RETURN 1)
    LET folderMismatches = (FOR expected IN @folders LET current = DOCUMENT(folders, expected._key) FILTER current == null || UNSET(current, "_id", "_rev") != expected RETURN 1)
    LET documentMismatches = (FOR expected IN @documents LET current = DOCUMENT(documents, expected._key) FILTER current == null || UNSET(current, "_id", "_rev") != expected RETURN 1)
    LET attachmentMismatches = (FOR expected IN @attachmentAssets
      LET target = expected.type == "document" ? DOCUMENT(documents, expected.key) : DOCUMENT(images, expected.key)
      LET folder = expected.type == "document" && target != null ? DOCUMENT(folders, expected.folderKey) : null
      LET placement = expected.type == "image" ? FIRST(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == expected.collectionKey && relation.imageKey == expected.key LIMIT 1 RETURN relation) : null
      LET collection = expected.type == "image" ? DOCUMENT(collections, expected.collectionKey) : null
      FILTER target == null || target.scopeKey != @scopeKey || target.mutationPolicy == "system-only"
        || (expected.type == "document" && (target.folderKey != expected.folderKey || folder == null || folder.scopeKey != @scopeKey))
        || (expected.type == "image" && (collection == null || collection.scopeKey != @scopeKey || placement == null))
      RETURN 1)
    LET fixtureConnectorKeys = (FOR connector IN organizationConnectors FILTER connector.scopeKey == @scopeKey && STARTS_WITH(connector.providerAccountId, @prefix) RETURN connector._key)
    LET extraFixtureConnectors = (FOR connectorKey IN fixtureConnectorKeys FILTER connectorKey NOT IN @connectorKeys RETURN 1)
    LET extraFixtureDocuments = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document._key NOT IN @documentKeys LET payload = JSON_PARSE(document.content) FILTER document.developmentFixtureIdentifier == @prefix || (payload.kind == "mail-thread" && STARTS_WITH(payload.data.providerThreadId, @prefix)) || (payload.kind == "mail-message" && STARTS_WITH(payload.data.providerMessageId, @prefix)) || (payload.kind == "mail-tone" && STARTS_WITH(payload.data.identifier || "", @prefix)) || (CONTAINS(document.content, "<!-- vorinthex-mail-tone ") && CONTAINS(document.content, @toneIdentifierFragment)) RETURN 1)
    RETURN { connectorMismatches: LENGTH(connectorMismatches), folderMismatches: LENGTH(folderMismatches), documentMismatches: LENGTH(documentMismatches), attachmentMismatches: LENGTH(attachmentMismatches), extraFixtureConnectors: LENGTH(extraFixtureConnectors), extraFixtureDocuments: LENGTH(extraFixtureDocuments) }`, {
    connectors: manifest.connectors.map(toArangoDoc), connectorKeys: manifest.connectors.map(({ key }) => key), folders: manifest.exportFolders, documents: manifest.documents.map(toArangoDoc), documentKeys: manifest.documents.map(({ key }) => key), attachmentAssets: manifest.attachmentAssets, scopeKey: manifest.fixtures.threads[0]!.thread.scopeKey, prefix: MAIL_DEV_FIXTURE_PREFIX, toneIdentifierFragment: `"identifier":"${MAIL_DEV_FIXTURE_PREFIX}:`,
  });
  const mismatches = await cursor.next() as Record<string, number> | undefined;
  if (!mismatches || Object.values(mismatches).some((count) => count !== 0)) throw new Error('Mail fixture verification failed.');
  const counts = { connectors: manifest.connectors.length };
  return { inboxes: manifest.inboxes.map(({ name }) => name), connectors: counts.connectors, threads: manifest.fixtures.threads.length, messages: manifest.fixtures.threads.reduce((sum, thread) => sum + thread.messages.length, 0), attachmentReferences: manifest.fixtures.threads.flatMap(({ messages }) => messages.flatMap(({ attachments }) => attachments ?? [])).length, drafts: manifest.fixtures.drafts.length, tones: manifest.fixtures.tones.length, replyContext: manifest.fixtures.replyContext.length };
}
