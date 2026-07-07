import { describe, expect, test } from 'bun:test';
import { intelligenceFragmentSchema } from '@/lib/db/intelligence-fragments.node';
import {
  dedupeFragmentEntries,
  fragmentsSummaryQuerySchema,
  postFragmentsBodySchema,
  summarizeFragmentEntries,
} from './fragments';

const validBody = {
  collectible_id: 'nexus-shard',
  explorer_id: 'vx_explorer_1234',
  name: 'Nexus Shard',
  rarity: 'common',
  fragments: 25,
};

describe('postFragmentsBodySchema', () => {
  test('accepts a valid collect payload', () => {
    const body = postFragmentsBodySchema.parse(validBody);
    expect(body.collectible_id).toBe('nexus-shard');
    expect(body.email_hash).toBeUndefined();
  });

  test('accepts an optional sha256 email hash', () => {
    const body = postFragmentsBodySchema.parse({ ...validBody, email_hash: 'a'.repeat(64) });
    expect(body.email_hash).toBe('a'.repeat(64));
  });

  test('accepts an optional temporary email hash for analytics stitching', () => {
    const body = postFragmentsBodySchema.parse({ ...validBody, temp_email_hash: 'b'.repeat(64) });
    expect(body.temp_email_hash).toBe('b'.repeat(64));
  });

  test('rejects unknown fields', () => {
    expect(() => postFragmentsBodySchema.parse({ ...validBody, extra: true })).toThrow();
  });

  test('rejects malformed email hashes', () => {
    expect(() => postFragmentsBodySchema.parse({ ...validBody, email_hash: 'not-a-hash' })).toThrow();
    expect(() => postFragmentsBodySchema.parse({ ...validBody, temp_email_hash: 'not-a-hash' })).toThrow();
  });

  test('rejects out-of-range fragment counts', () => {
    expect(() => postFragmentsBodySchema.parse({ ...validBody, fragments: 0 })).toThrow();
    // Million-class asteroid crystals are the ceiling.
    expect(() => postFragmentsBodySchema.parse({ ...validBody, fragments: 1_000_001 })).toThrow();
    expect(postFragmentsBodySchema.parse({ ...validBody, fragments: 1_000_000 }).fragments).toBe(1_000_000);
    expect(() => postFragmentsBodySchema.parse({ ...validBody, fragments: 1.5 })).toThrow();
  });

  test('rejects too-short explorer ids', () => {
    expect(() => postFragmentsBodySchema.parse({ ...validBody, explorer_id: 'short' })).toThrow();
  });
});

describe('fragmentsSummaryQuerySchema', () => {
  test('accepts explorer_id and the three format flag', () => {
    const query = fragmentsSummaryQuerySchema.parse({ explorer_id: 'vx_explorer_1234', format: 'three' });
    expect(query.format).toBe('three');
  });

  test('rejects unknown formats and extra params', () => {
    expect(() => fragmentsSummaryQuerySchema.parse({ format: 'json' })).toThrow();
    expect(() => fragmentsSummaryQuerySchema.parse({ extra: '1' })).toThrow();
  });
});

describe('intelligenceFragmentSchema', () => {
  test('defaults userId to null until adoption', () => {
    const fragment = intelligenceFragmentSchema.parse({
      key: 'frag_test',
      explorerId: 'vx_explorer_1234',
      collectibleId: 'nexus-shard',
      name: 'Nexus Shard',
      rarity: 'common',
      fragments: 25,
      createdAt: '2026-07-06T00:00:00.000Z',
    });
    expect(fragment.userId).toBeNull();
    expect(fragment.embedding).toEqual([]);
  });

  test('rejects non-positive fragment counts', () => {
    expect(() => intelligenceFragmentSchema.parse({
      key: 'frag_test',
      explorerId: 'vx_explorer_1234',
      collectibleId: 'nexus-shard',
      name: 'Nexus Shard',
      rarity: 'common',
      fragments: 0,
      createdAt: '2026-07-06T00:00:00.000Z',
    })).toThrow();
  });
});

describe('fragment summaries', () => {
  const entries = [
    { key: 'frag_a', collectibleId: 'nexus-shard', fragments: 25 },
    { key: 'frag_b', collectibleId: 'founder-core', fragments: 100 },
    // Adopted entry returned by both the explorer and the user lookup.
    { key: 'frag_a', collectibleId: 'nexus-shard', fragments: 25 },
  ];

  test('dedupeFragmentEntries drops duplicate keys from merged lookups', () => {
    expect(dedupeFragmentEntries(entries).map((entry) => entry.key)).toEqual(['frag_a', 'frag_b']);
  });

  test('summarizeFragmentEntries sums the balance and lists claimed collectibles once', () => {
    expect(summarizeFragmentEntries(entries)).toEqual({
      balance: 125,
      claimed: ['nexus-shard', 'founder-core'],
    });
  });

  test('summarizes empty collections to a zero balance', () => {
    expect(summarizeFragmentEntries([])).toEqual({ balance: 0, claimed: [] });
  });
});
