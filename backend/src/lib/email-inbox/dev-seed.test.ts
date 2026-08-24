import { describe, expect, test } from 'bun:test';
import { assertLocalMailSeedEnvironment, buildMailDevSeedManifest, mailDevFixtureKey, reconcileMailDevSeed, verifyMailDevSeed } from './dev-seed';

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
    expect(first.connectors.every((connector) => connector.status === 'error' && !connector.syncEnabled && connector.syncStatus === 'idle' && !connector.watchRegisteredAt && !connector.historyId)).toBe(true);
    expect(first.inboxes.map(({ connectorKey }) => connectorKey)).toEqual(first.connectors.map(({ key }) => key));
    expect(new Set(first.documents.map(({ key }) => key)).size).toBe(first.documents.length);
    expect(first.documents.every(({ scopeKey: value, createdAt, updatedAt }) => value === scopeKey && createdAt === updatedAt)).toBe(true);
    expect(first.documents.every(({ developmentFixtureIdentifier }) => developmentFixtureIdentifier === 'vorinthex-local-signal-v1')).toBe(true);
    expect(mailDevFixtureKey('x', 'y')).toBe(mailDevFixtureKey('x', 'y'));
  });

  test('reconciliation uses change-filtered upserts and fixture-bounded stale cleanup', async () => {
    const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database = { async query(query: string, bindVars?: Record<string, unknown>) { queries.push({ query, bindVars }); return { async next() { return 0; }, async all() { return []; } }; } };
    const manifest = buildMailDevSeedManifest({ organizationKey, scopeKey, membershipKey, credentials });
    await reconcileMailDevSeed(database, manifest);
    expect(queries.slice(0, 3).every(({ query }) => query.includes('FILTER current == null ||') && query.includes('UPSERT'))).toBe(true);
    expect(queries[3]!.query).toContain('staleConnectorKeys');
    expect(queries[3]!.query).toContain('keepInboxKeys');
    expect(queries[4]!.query).toContain('document.developmentFixtureIdentifier == @prefix');
    expect(queries[4]!.query).toContain('<!-- vorinthex-mail-tone ');
    expect(queries[4]!.bindVars?.keep).toEqual(manifest.documents.map(({ key }) => key));
  });

  test('verification compares exact fixture state while preserving only encrypted credential fields', async () => {
    let query = '';
    const database = { async query(value: string) { query = value; return { async next() { return { connectorMismatches: 0, inboxMismatches: 0, documentMismatches: 0, extraFixtureConnectors: 0, extraFixtureInboxes: 0, extraFixtureDocuments: 0 }; }, async all() { return []; } }; } };
    const manifest = buildMailDevSeedManifest({ organizationKey, scopeKey, membershipKey, credentials });
    await expect(verifyMailDevSeed(database, manifest)).resolves.toMatchObject({ connectors: 3, threads: 27, messages: 54 });
    expect(query).toContain('UNSET(current, "_id", "_rev") != desired');
    expect(query).toContain('extraFixtureDocuments');
    expect(query).toContain('extraFixtureInboxes');
    expect(query).toContain('document.developmentFixtureIdentifier == @prefix');
  });

  test('verification rejects any extra fixture-owned entity', async () => {
    const database = { async query() { return { async next() { return { connectorMismatches: 0, inboxMismatches: 0, documentMismatches: 0, extraFixtureConnectors: 0, extraFixtureInboxes: 0, extraFixtureDocuments: 1 }; }, async all() { return []; } }; } };
    const manifest = buildMailDevSeedManifest({ organizationKey, scopeKey, membershipKey, credentials });
    await expect(verifyMailDevSeed(database, manifest)).rejects.toThrow('Mail fixture verification failed');
  });
});
