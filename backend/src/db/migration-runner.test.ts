import { describe, expect, test } from 'bun:test';
import { runGraphMigrations, validateMigrationRegistry } from './migration-runner';
import type { GraphMigration } from './migrations/types';

const checksum = (value: string) => value.repeat(64).slice(0, 64);

function databaseWith(applied: Array<{ id: string; checksum: string; status: 'applying' | 'applied' | 'failed' }> = []) {
  const queries: Array<{ source: string; bindVars?: Record<string, unknown> }> = [];
  let created = 0;
  let indexed = 0;
  return {
    database: {
      collection: () => ({
        exists: async () => created > 0 || applied.length > 0,
        create: async () => { created += 1; },
        ensureIndex: async () => { indexed += 1; },
      }),
      query: async (source: string, bindVars?: Record<string, unknown>) => {
        queries.push({ source, bindVars });
        return { all: async () => source.includes('RETURN { id: migration.id') ? applied : [], next: async () => source.includes('RETURN NEW.status') || source.includes('RETURN true') ? true : undefined };
      },
    },
    queries,
    counts: () => ({ created, indexed }),
  };
}

const migration = (id: string, checksumValue: string, calls: string[]): GraphMigration => ({ id, checksum: async () => checksumValue, up: async () => { calls.push(id); } });

describe('versioned graph migrations', () => {
  test('runs only unapplied migrations in order and records successful applications', async () => {
    const fixture = databaseWith([{ id: '0001-first', checksum: checksum('a'), status: 'applied' }]);
    const calls: string[] = [];
    await runGraphMigrations(fixture.database as never, [migration('0001-first', checksum('a'), calls), migration('0002-second', checksum('b'), calls)], () => new Date('2026-09-08T00:00:00.000Z'));
    expect(calls).toEqual(['0002-second']);
    expect(fixture.queries.some(({ source, bindVars }) => source.includes('UPSERT { id: @id }') && bindVars?.id === '0002-second')).toBe(true);
    expect(fixture.queries.some(({ source, bindVars }) => source.includes('status: "applied"') && bindVars?.id === '0002-second')).toBe(true);
    expect(fixture.counts()).toEqual({ created: 0, indexed: 1 });
  });

  test('records a failed migration so it remains visible and retryable', async () => {
    const fixture = databaseWith();
    await expect(runGraphMigrations(fixture.database as never, [{ id: '0001-first', checksum: async () => checksum('a'), up: async () => { throw new Error('failed'); } }])).rejects.toThrow('failed');
    expect(fixture.queries.some(({ source }) => source.includes('status: "failed"'))).toBe(true);
  });

  test('rejects edited, duplicate, and out-of-order migrations', async () => {
    const fixture = databaseWith([{ id: '0001-first', checksum: checksum('a'), status: 'applied' }]);
    await expect(runGraphMigrations(fixture.database as never, [{ id: '0001-first', checksum: async () => checksum('b'), up: async () => {} }])).rejects.toThrow('was modified');
    expect(() => validateMigrationRegistry([migration('0001-first', checksum('a'), []), migration('0001-first', checksum('b'), [])])).toThrow('unique');
    expect(() => validateMigrationRegistry([migration('0002-second', checksum('a'), []), migration('0001-first', checksum('b'), [])])).toThrow('ordered');
  });

  test('accepts an explicitly compatible checksum for an amended migration', async () => {
    const fixture = databaseWith([{ id: '0001-first', checksum: checksum('a'), status: 'applied' }]);
    const calls: string[] = [];
    await runGraphMigrations(fixture.database as never, [{ ...migration('0001-first', checksum('b'), calls), compatibleChecksums: [checksum('a')] }]);
    expect(calls).toEqual([]);
  });

  test('rejects a database migrated by a newer or incomplete registry', async () => {
    const fixture = databaseWith([{ id: '0002-newer', checksum: checksum('a'), status: 'applied' }]);
    await expect(runGraphMigrations(fixture.database as never, [])).rejects.toThrow('absent from this build');
  });

  test('reclaims a failed migration without hiding its prior attempt', async () => {
    const fixture = databaseWith([{ id: '0001-first', checksum: checksum('a'), status: 'failed' }]);
    const calls: string[] = [];
    await runGraphMigrations(fixture.database as never, [migration('0001-first', checksum('a'), calls)]);
    expect(calls).toEqual(['0001-first']);
    expect(fixture.queries.some(({ source }) => source.includes('OLD.status == "failed"'))).toBe(true);
    expect(fixture.queries.some(({ source }) => source.includes('? { checksum: @checksum, status: "applying"'))).toBe(true);
  });
});
