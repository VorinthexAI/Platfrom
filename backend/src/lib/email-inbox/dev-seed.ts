import { createHash } from 'node:crypto';
import { toArangoDoc } from '@/lib/db/base';
import { archiveDocument, emailDraftPayloadSchema, emailMessagePayloadSchema, emailReplyContextPayloadSchema, emailThreadPayloadSchema, emailTonePayloadSchema, encodeEmailToneContent, prepareEmailReplyContextDocument, prepareEmailToneDocument } from './archive-payloads';
import { organizationConnectorSchema } from './connector-schema';
import { inboxSchema } from './inbox-schema';
import { mailFolderKeys } from './folders';
import { MAIL_DEV_FIXTURE_AT, MAIL_DEV_FIXTURE_PREFIX, mailDevFixtures } from './dev-fixtures';

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
  const folders = mailFolderKeys(input.scopeKey);
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
    syncStatus: 'idle',
    syncError: 'Local fixture connector; provider access is disabled.',
    lastError: 'Local fixture connector; provider access is disabled.',
    createdAt: MAIL_DEV_FIXTURE_AT,
    updatedAt: MAIL_DEV_FIXTURE_AT,
    });
  });
  const inboxes = fixtures.accounts.map((account, index) => inboxSchema.parse({
    key: mailDevFixtureKey('mail-dev-inbox', input.scopeKey, account.slug),
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
  const documents = fixtures.threads.flatMap(({ thread, messages }) => {
    const threadKey = mailDevFixtureKey('mail-thread', thread.scopeKey, thread.accountKey, thread.providerThreadId);
    const threadPayload = emailThreadPayloadSchema.parse({ version: 1, kind: 'mail-thread', data: withoutArchiveFields(thread) });
    const threadDocument = archiveDocument({ key: threadKey, scopeKey: input.scopeKey, folderKey: folders.threads, name: thread.subject, payload: threadPayload, embedding: thread.embedding, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT, developmentFixtureIdentifier: MAIL_DEV_FIXTURE_PREFIX });
    const messageDocuments = messages.map((message) => {
      const key = mailDevFixtureKey('mail-message', message.scopeKey, message.accountKey, message.providerMessageId);
      const payload = emailMessagePayloadSchema.parse({ version: 1, kind: 'mail-message', data: { ...withoutArchiveFields(message), threadKey } });
      return archiveDocument({ key, scopeKey: input.scopeKey, folderKey: folders.threads, name: message.subject, payload, embedding: message.embedding, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT, developmentFixtureIdentifier: MAIL_DEV_FIXTURE_PREFIX });
    });
    return [threadDocument, ...messageDocuments];
  });
  for (const tone of fixtures.tones) {
    const slug = 'slug' in tone ? tone.slug : undefined;
    const key = slug ? mailDevFixtureKey('mail-tone', input.scopeKey, slug) : mailDevFixtureKey('mail-dev-tone', input.scopeKey, tone.id);
    const data = emailTonePayloadSchema.shape.data.parse({ ...(slug ? { slug } : { identifier: `${MAIL_DEV_FIXTURE_PREFIX}:${tone.id}` }), name: tone.name, instruction: tone.instruction });
    const embedding = fixtures.threads[fixtures.tones.indexOf(tone)]!.thread.embedding;
    const payload = emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data });
    const document = archiveDocument({ key, scopeKey: input.scopeKey, folderKey: folders.tones, name: tone.name, payload, embedding, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT, mutationPolicy: 'user', developmentFixtureIdentifier: MAIL_DEV_FIXTURE_PREFIX });
    document.content = encodeEmailToneContent(data);
    document.isFavorite = tone.isFavorite;
    documents.push(prepareEmailToneDocument(document, data, embedding));
  }
  for (const note of fixtures.replyContext) {
    const key = mailDevFixtureKey('mail-dev-reply-context', input.scopeKey, note.id);
    const data = emailReplyContextPayloadSchema.shape.data.parse({ name: note.name, text: note.text });
    const embedding = fixtures.threads[fixtures.replyContext.indexOf(note) + 6]!.thread.embedding;
    const payload = emailReplyContextPayloadSchema.parse({ version: 1, kind: 'mail-reply-context', data });
    const document = archiveDocument({ key, scopeKey: input.scopeKey, folderKey: folders.replyContext, name: note.name, payload, embedding, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT, developmentFixtureIdentifier: MAIL_DEV_FIXTURE_PREFIX });
    documents.push(prepareEmailReplyContextDocument(document, data, embedding));
  }
  for (const draft of fixtures.drafts) {
    const key = mailDevFixtureKey('mail-dev-draft', input.scopeKey, draft.id);
    const thread = fixtures.threads.find(({ fixtureId }) => fixtureId === draft.threadFixtureId);
    const data = draft.variant === 'new'
      ? { variant: 'new' as const, accountKey: draft.accountKey, to: draft.to, ...('cc' in draft ? { cc: draft.cc } : {}), ...('bcc' in draft ? { bcc: draft.bcc } : {}), subject: draft.subject, generatedContent: draft.generatedContent, ...('finalContent' in draft ? { finalContent: draft.finalContent } : {}), status: draft.status, tone: draft.tone }
      : { variant: 'reply' as const, replyMode: draft.replyMode, threadKey: mailDevFixtureKey('mail-thread', input.scopeKey, draft.accountKey, draft.threadFixtureId), messageKey: mailDevFixtureKey('mail-message', input.scopeKey, draft.accountKey, draft.messageProviderId), to: draft.to, cc: draft.cc, generatedContent: draft.generatedContent, ...('finalContent' in draft ? { finalContent: draft.finalContent } : {}), status: draft.status, tone: draft.tone };
    if (draft.variant === 'reply' && !thread) throw new Error(`Fixture draft ${draft.id} has no thread.`);
    const kind = draft.variant === 'new' ? 'mail-new-draft' : 'mail-reply-draft';
    const payload = emailDraftPayloadSchema.parse({ version: 1, kind, data });
    const embedding = fixtures.threads[fixtures.drafts.indexOf(draft) + 12]!.thread.embedding;
    documents.push(archiveDocument({ key, scopeKey: input.scopeKey, folderKey: folders.drafts, name: draft.variant === 'new' ? draft.subject : `Reply ${draft.threadFixtureId}`, payload, embedding, createdAt: MAIL_DEV_FIXTURE_AT, updatedAt: MAIL_DEV_FIXTURE_AT, developmentFixtureIdentifier: MAIL_DEV_FIXTURE_PREFIX }));
  }
  return { fixtures, connectors, inboxes, documents, accountKeys };
}

type SeedDatabase = { query(query: string, bindVars?: Record<string, unknown>): Promise<{ next(): Promise<unknown>; all(): Promise<unknown[]> }> };

export async function reconcileMailDevSeed(database: SeedDatabase, manifest: ReturnType<typeof buildMailDevSeedManifest>) {
  const persist = async (collection: string, values: unknown[], preserveCredentials = false) => {
    const cursor = await database.query(`FOR expected IN @values
      LET current = DOCUMENT(@@collection, expected._key)
      LET desired = @preserveCredentials && current != null ? MERGE(expected, { encryptedCredentials: current.encryptedCredentials, encryptionKeyId: current.encryptionKeyId, accessTokenFingerprint: current.accessTokenFingerprint }) : expected
      FILTER current == null || UNSET(current, "_id", "_rev") != desired
      UPSERT { _key: expected._key } INSERT desired REPLACE desired IN @@collection
      COLLECT WITH COUNT INTO changed RETURN changed`, { '@collection': collection, values, preserveCredentials });
    return Number(await cursor.next() ?? 0);
  };
  await persist('organizationConnectors', manifest.connectors.map(toArangoDoc), true);
  await persist('inboxes', manifest.inboxes.map(toArangoDoc));
  await persist('documents', manifest.documents.map(toArangoDoc));
  await database.query(`LET fixtureConnectorKeys = (FOR connector IN organizationConnectors FILTER connector.scopeKey == @scopeKey && STARTS_WITH(connector.providerAccountId, @prefix) RETURN connector._key)
    LET staleConnectorKeys = MINUS(fixtureConnectorKeys, @keepConnectorKeys)
    LET removedInboxes = (FOR inbox IN inboxes FILTER inbox.scopeKey == @scopeKey && inbox.connectorKey IN fixtureConnectorKeys && inbox._key NOT IN @keepInboxKeys REMOVE inbox IN inboxes RETURN 1)
    FOR connector IN organizationConnectors FILTER connector._key IN staleConnectorKeys REMOVE connector IN organizationConnectors`, { scopeKey: manifest.fixtures.threads[0]!.thread.scopeKey, prefix: MAIL_DEV_FIXTURE_PREFIX, keepConnectorKeys: manifest.connectors.map(({ key }) => key), keepInboxKeys: manifest.inboxes.map(({ key }) => key) });
  const keepDocumentKeys = manifest.documents.map(({ key }) => key);
  await database.query(`FOR document IN documents
    FILTER document.scopeKey == @scopeKey && document._key NOT IN @keep
    LET payload = JSON_PARSE(document.content)
    FILTER document.developmentFixtureIdentifier == @prefix || (payload.kind == "mail-thread" && STARTS_WITH(payload.data.providerThreadId, @prefix)) || (payload.kind == "mail-message" && STARTS_WITH(payload.data.providerMessageId, @prefix)) || (payload.kind == "mail-tone" && STARTS_WITH(payload.data.identifier || "", @prefix)) || (CONTAINS(document.content, "<!-- vorinthex-mail-tone ") && CONTAINS(document.content, @toneIdentifierFragment))
    REMOVE document IN documents`, { scopeKey: manifest.fixtures.threads[0]!.thread.scopeKey, keep: keepDocumentKeys, prefix: MAIL_DEV_FIXTURE_PREFIX, toneIdentifierFragment: `"identifier":"${MAIL_DEV_FIXTURE_PREFIX}:` });
}

export async function verifyMailDevSeed(database: SeedDatabase, manifest: ReturnType<typeof buildMailDevSeedManifest>) {
  const cursor = await database.query(`LET connectorMismatches = (FOR expected IN @connectors
      LET current = DOCUMENT(organizationConnectors, expected._key)
      LET desired = current == null ? expected : MERGE(expected, { encryptedCredentials: current.encryptedCredentials, encryptionKeyId: current.encryptionKeyId, accessTokenFingerprint: current.accessTokenFingerprint })
      FILTER current == null || UNSET(current, "_id", "_rev") != desired RETURN 1)
    LET inboxMismatches = (FOR expected IN @inboxes LET current = DOCUMENT(inboxes, expected._key) FILTER current == null || UNSET(current, "_id", "_rev") != expected RETURN 1)
    LET documentMismatches = (FOR expected IN @documents LET current = DOCUMENT(documents, expected._key) FILTER current == null || UNSET(current, "_id", "_rev") != expected RETURN 1)
    LET fixtureConnectorKeys = (FOR connector IN organizationConnectors FILTER connector.scopeKey == @scopeKey && STARTS_WITH(connector.providerAccountId, @prefix) RETURN connector._key)
    LET extraFixtureConnectors = (FOR connectorKey IN fixtureConnectorKeys FILTER connectorKey NOT IN @connectorKeys RETURN 1)
    LET extraFixtureInboxes = (FOR inbox IN inboxes FILTER inbox.scopeKey == @scopeKey && inbox.connectorKey IN fixtureConnectorKeys && inbox._key NOT IN @inboxKeys RETURN 1)
    LET extraFixtureDocuments = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document._key NOT IN @documentKeys LET payload = JSON_PARSE(document.content) FILTER document.developmentFixtureIdentifier == @prefix || (payload.kind == "mail-thread" && STARTS_WITH(payload.data.providerThreadId, @prefix)) || (payload.kind == "mail-message" && STARTS_WITH(payload.data.providerMessageId, @prefix)) || (payload.kind == "mail-tone" && STARTS_WITH(payload.data.identifier || "", @prefix)) || (CONTAINS(document.content, "<!-- vorinthex-mail-tone ") && CONTAINS(document.content, @toneIdentifierFragment)) RETURN 1)
    RETURN { connectorMismatches: LENGTH(connectorMismatches), inboxMismatches: LENGTH(inboxMismatches), documentMismatches: LENGTH(documentMismatches), extraFixtureConnectors: LENGTH(extraFixtureConnectors), extraFixtureInboxes: LENGTH(extraFixtureInboxes), extraFixtureDocuments: LENGTH(extraFixtureDocuments) }`, {
    connectors: manifest.connectors.map(toArangoDoc), connectorKeys: manifest.connectors.map(({ key }) => key), inboxes: manifest.inboxes.map(toArangoDoc), inboxKeys: manifest.inboxes.map(({ key }) => key), documents: manifest.documents.map(toArangoDoc), documentKeys: manifest.documents.map(({ key }) => key), scopeKey: manifest.fixtures.threads[0]!.thread.scopeKey, prefix: MAIL_DEV_FIXTURE_PREFIX, toneIdentifierFragment: `"identifier":"${MAIL_DEV_FIXTURE_PREFIX}:`,
  });
  const mismatches = await cursor.next() as Record<string, number> | undefined;
  if (!mismatches || Object.values(mismatches).some((count) => count !== 0)) throw new Error('Mail fixture verification failed.');
  const counts = { connectors: manifest.connectors.length };
  return { inboxes: manifest.inboxes.map(({ name }) => name), connectors: counts.connectors, threads: manifest.fixtures.threads.length, messages: manifest.fixtures.threads.reduce((sum, thread) => sum + thread.messages.length, 0), drafts: manifest.fixtures.drafts.length, tones: manifest.fixtures.tones.length, replyContext: manifest.fixtures.replyContext.length };
}
