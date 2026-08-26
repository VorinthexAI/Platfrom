import { describe, expect, test } from 'bun:test';
import { assertLocalMailSeedEnvironment, buildMailDevSeedManifest, mailDevFixtureKey, reconcileMailDevSeed, verifyMailDevSeed } from './dev-seed';
import { folderSchema } from '@/lib/db/folders.node';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { mailFolderKeys } from './folders';
import { createEmailRepository } from './repository';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const organizationKey = 'cmrnlzf650002qc7k4p5zem5w';
const membershipKey = 'cmrnlzf660003qc7kmember001';
const credentials = () => ({ encryptedCredentials: 'v1:fixture:fixture:fixture', encryptionKeyId: 'fixture', accessTokenFingerprint: '0'.repeat(64) });

describe('mail development seed safety', () => {
  test('accepts only explicit loopback URLs outside production', () => {
    for (const ARANGO_URL of ['http://localhost:8529', 'http://127.0.0.1:8529', 'https://127.255.255.254', 'http://[::1]:8529']) expect(() => assertLocalMailSeedEnvironment({ NODE_ENV: 'development', ARANGO_URL })).not.toThrow();
    for (const ARANGO_URL of ['http://localhost.evil.test:8529', 'http://localhost.:8529', 'http://127.0.0.1.evil.test', 'http://127.1:8529', 'http://0177.0.0.1', 'http://2130706433', 'http://10.2.3.4', 'http://172.31.1.2', 'http://192.168.1.5', 'http://169.254.1.2', 'http://[fd00::1]:8529', 'http://8.8.8.8', 'https://example.com', 'file:///tmp/db', 'http://user:secret@localhost:8529']) expect(() => assertLocalMailSeedEnvironment({ NODE_ENV: 'development', ARANGO_URL })).toThrow();
    expect(() => assertLocalMailSeedEnvironment({ NODE_ENV: 'production', ARANGO_URL: 'http://localhost:8529' })).toThrow();
    expect(() => assertLocalMailSeedEnvironment({ NODE_ENV: ' Production ', ARANGO_URL: 'http://localhost:8529' })).toThrow();
  });

  test('builds schema-valid deterministic disabled connectors, inboxes, and archive documents', () => {
    const first = buildMailDevSeedManifest({ organizationKey, scopeKey, membershipKey, credentials });
    const second = buildMailDevSeedManifest({ organizationKey, scopeKey, membershipKey, credentials });
    expect(second).toEqual(first);
    expect(first.connectors).toHaveLength(3);
    expect(first.fixtures.threads).toHaveLength(27);
    expect(first.fixtures.threads.reduce((sum, thread) => sum + thread.messages.length, 0)).toBe(54);
    expect(first.fixtures.drafts).toHaveLength(6);
    expect(first.fixtures.tones).toHaveLength(3);
    expect(first.fixtures.replyContext).toHaveLength(5);
    expect(first.attachmentAssets).toHaveLength(9);
    expect(first.connectors.every((connector) => connector.status === 'error' && !connector.syncEnabled && connector.initialSyncCompleted && connector.syncStatus === 'idle' && !connector.watchRegisteredAt && !connector.historyId)).toBe(true);
    expect(first.inboxes.map(({ connectorKey }) => connectorKey)).toEqual(first.connectors.map(({ key }) => key));
    expect(first.inboxes.map(({ key }) => key)).toEqual(first.managedFolders.filter(({ managedPurpose }) => managedPurpose === 'mail-inbox').map(({ _key }) => String(_key)));
    expect(first.managedFolders.every((folder) => folderSchema.safeParse(withArangoKey(folder)).success)).toBe(true);
    expect(first.managedFolders.filter(({ managedPurpose }) => managedPurpose === 'mail-inbox')).toHaveLength(3);
    expect(first.managedFolders.filter(({ managedPurpose }) => managedPurpose === 'mail-inbox-files')).toHaveLength(3);
    expect(first.managedFolders.filter(({ managedPurpose }) => managedPurpose === 'mail-thread')).toHaveLength(0);
    expect(first.documents.filter(({ archiveVisibility }) => archiveVisibility === 'domain-only')).toHaveLength(27);
    const threadKeys = new Set(first.documents.filter(({ archiveVisibility }) => archiveVisibility === 'domain-only').map(({ key }) => key));
    expect(first.documents.filter(({ key }) => threadKeys.has(key)).every(({ folderKey }) => folderKey === mailFolderKeys(scopeKey).threads)).toBe(true);
    expect(first.documents.filter((document) => !threadKeys.has(document.key) && document.content.startsWith('{') && JSON.parse(document.content).kind === 'mail-message').every(({ folderKey }) => first.inboxes.some(({ key }) => key === folderKey))).toBe(true);
    expect(new Set(first.documents.map(({ key }) => key)).size).toBe(first.documents.length);
    expect(first.documents.every(({ scopeKey: value, createdAt, updatedAt }) => value === scopeKey && createdAt === updatedAt)).toBe(true);
    expect(first.documents.every(({ developmentFixtureIdentifier }) => developmentFixtureIdentifier === 'vorinthex-local-signal-v1')).toBe(true);
    const fixtureRefs = first.fixtures.threads.flatMap(({ messages }) => messages.flatMap(({ attachments }) => attachments ?? []));
    const seededRefs = new Set(first.attachmentAssets.map(({ type, key }) => `${type}:${key}`));
    expect(fixtureRefs.every(({ type, key }) => seededRefs.has(`${type}:${key}`))).toBe(true);
    expect(mailDevFixtureKey('x', 'y')).toBe(mailDevFixtureKey('x', 'y'));
  });

  test('canonical thread detail preserves fixture attachments on every message', async () => {
    const manifest = buildMailDevSeedManifest({ organizationKey, scopeKey, membershipKey, credentials });
    const fixture = manifest.fixtures.threads.find(({ messages }) => messages.every(({ hasAttachments }) => hasAttachments));
    if (!fixture) throw new Error('Expected an attachment fixture spanning both thread messages.');
    const threadKey = mailDevFixtureKey('mail-thread', scopeKey, fixture.thread.accountKey, fixture.thread.providerThreadId);
    const threadDocument = manifest.documents.find(({ key }) => key === threadKey)!;
    const messageDocuments = manifest.documents.filter((document) => {
      if (!document.content.startsWith('{')) return false;
      const payload = JSON.parse(document.content);
      return payload.kind === 'mail-message' && payload.data.threadKey === threadKey;
    });
    const database = {
      async query(_query: string, bindVars?: Record<string, unknown>) {
        const values = bindVars?.key === threadKey ? [toArangoDoc(threadDocument)] : bindVars?.folderKey ? messageDocuments.map(toArangoDoc) : [];
        return { async next() { return values[0]; }, async all() { return values; } };
      },
      collection() { return {}; },
    };
    const detail = await createEmailRepository(database as never).thread(scopeKey, threadKey);
    expect(detail.messages.map(({ attachments }) => attachments)).toEqual(fixture.messages.map(({ attachments }) => attachments));
    expect(detail.messages.map(({ attachmentAvailability }) => attachmentAvailability)).toEqual(['complete', 'complete']);
  });

  test('reconciliation uses change-filtered upserts and fixture-bounded stale cleanup', async () => {
    const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database = { async query(query: string, bindVars?: Record<string, unknown>) { queries.push({ query, bindVars }); return { async next() { return 0; }, async all() { return []; } }; } };
    const manifest = buildMailDevSeedManifest({ organizationKey, scopeKey, membershipKey, credentials });
    await reconcileMailDevSeed(database, manifest);
    expect(queries.slice(0, 3).every(({ query }) => query.includes('FILTER current == null ||') && query.includes('UPSERT'))).toBe(true);
    expect(queries[3]!.query).toContain('staleConnectorKeys');
    expect(queries[3]!.query).not.toContain('inboxes');
    expect(queries[4]!.query).toContain('document.developmentFixtureIdentifier == @prefix');
    expect(queries[4]!.query).toContain('<!-- vorinthex-mail-tone ');
    expect(queries[4]!.bindVars?.keep).toEqual(manifest.documents.map(({ key }) => key));
  });

  test('verification compares exact fixture state while preserving only encrypted credential fields', async () => {
    let query = '';
    const database = { async query(value: string) { query = value; return { async next() { return { connectorMismatches: 0, folderMismatches: 0, documentMismatches: 0, attachmentMismatches: 0, extraFixtureConnectors: 0, extraFixtureDocuments: 0 }; }, async all() { return []; } }; } };
    const manifest = buildMailDevSeedManifest({ organizationKey, scopeKey, membershipKey, credentials });
    await expect(verifyMailDevSeed(database, manifest)).resolves.toMatchObject({ connectors: 3, threads: 27, messages: 54, attachmentReferences: 13 });
    expect(query).toContain('UNSET(current, "_id", "_rev") != desired');
    expect(query).toContain('extraFixtureDocuments');
    expect(query).toContain('folderMismatches');
    expect(query).toContain('attachmentMismatches');
    expect(query).toContain('relation.collectionKey == expected.collectionKey');
    expect(query).not.toContain('DOCUMENT(inboxes');
    expect(query).toContain('document.developmentFixtureIdentifier == @prefix');
  });

  test('verification rejects any extra fixture-owned entity', async () => {
    const database = { async query() { return { async next() { return { connectorMismatches: 0, folderMismatches: 0, documentMismatches: 0, attachmentMismatches: 0, extraFixtureConnectors: 0, extraFixtureDocuments: 1 }; }, async all() { return []; } }; } };
    const manifest = buildMailDevSeedManifest({ organizationKey, scopeKey, membershipKey, credentials });
    await expect(verifyMailDevSeed(database, manifest)).rejects.toThrow('Mail fixture verification failed');
  });
});
