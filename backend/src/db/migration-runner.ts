import { randomUUID } from 'node:crypto';
import { Database } from 'arangojs';
import { z } from 'zod';
import { graphMigrations } from './migrations';
import type { GraphMigration } from './migrations/types';

const MIGRATIONS_COLLECTION = 'schemaMigrations';
const MIGRATION_CLAIM_MS = 6 * 60 * 60_000;
const MIGRATION_HEARTBEAT_MS = 60_000;
const migrationIdSchema = z.string().regex(/^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/);
const migrationChecksumSchema = z.string().regex(/^[a-f0-9]{64}$/);
const ledgerMigrationSchema = z.object({ id: migrationIdSchema, checksum: migrationChecksumSchema, status: z.enum(['applying', 'applied', 'failed']) }).strict();

type MigrationDatabase = Pick<Database, 'collection' | 'query'>;

export function validateMigrationRegistry(migrations: readonly GraphMigration[]) {
  const ids = migrations.map(({ id }) => migrationIdSchema.parse(id));
  if (new Set(ids).size !== ids.length) throw new Error('Graph migration IDs must be unique.');
  if (ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) throw new Error('Graph migrations must be ordered by ID.');
}

export async function runGraphMigrations(database: MigrationDatabase, migrations: readonly GraphMigration[] = graphMigrations, now = () => new Date()) {
  validateMigrationRegistry(migrations);
  const collection = database.collection(MIGRATIONS_COLLECTION);
  if (!await collection.exists()) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['id'], unique: true });

  const cursor = await database.query(`FOR migration IN ${MIGRATIONS_COLLECTION} RETURN { id: migration.id, checksum: migration.checksum, status: migration.status }`);
  const ledger = new Map((await cursor.all()).map((value) => {
    const parsed = ledgerMigrationSchema.parse(value);
    return [parsed.id, parsed] as const;
  }));
  const registeredIds = new Set(migrations.map(({ id }) => id));
  const unknownMigrations = [...ledger.keys()].filter((id) => !registeredIds.has(id));
  if (unknownMigrations.length > 0) throw new Error(`Database contains migrations absent from this build: ${unknownMigrations.join(', ')}.`);

  for (const migration of migrations) {
    const checksum = migrationChecksumSchema.parse(await migration.checksum());
    const existing = ledger.get(migration.id);
    if (existing) {
      const compatibleChecksums = (migration.compatibleChecksums ?? []).map((value) => migrationChecksumSchema.parse(value));
      if (existing.checksum !== checksum && !compatibleChecksums.includes(existing.checksum)) throw new Error(`Recorded graph migration ${migration.id} was modified.`);
      if (existing.status === 'applied') continue;
    }

    const claimToken = randomUUID();
    const claimedAt = now().toISOString();
    const claimExpiresAt = new Date(Date.parse(claimedAt) + MIGRATION_CLAIM_MS).toISOString();
    const claim = await database.query(`
      UPSERT { id: @id }
        INSERT { id: @id, checksum: @checksum, status: "applying", claimToken: @claimToken, claimedAt: @claimedAt, claimExpiresAt: @claimExpiresAt }
        UPDATE (OLD.status == "failed" || (OLD.status == "applying" && OLD.claimExpiresAt <= @claimedAt)
          ? { checksum: @checksum, status: "applying", failedAt: null, claimToken: @claimToken, claimedAt: @claimedAt, claimExpiresAt: @claimExpiresAt }
          : {})
        IN ${MIGRATIONS_COLLECTION}
      RETURN NEW.status == "applying" && NEW.claimToken == @claimToken
    `, { id: migration.id, checksum, claimToken, claimedAt, claimExpiresAt });
    if (await claim.next() !== true) throw new Error(`Graph migration ${migration.id} is already claimed by another runner.`);

    console.log(`Applying graph migration ${migration.id}`);
    let claimLost = false;
    let renewal = Promise.resolve();
    const heartbeat = setInterval(() => {
      renewal = renewal.then(async () => {
        const renewedAt = now().toISOString();
        const renewedUntil = new Date(Date.parse(renewedAt) + MIGRATION_CLAIM_MS).toISOString();
        const renewed = await database.query(`FOR migration IN ${MIGRATIONS_COLLECTION} FILTER migration.id == @id && migration.status == "applying" && migration.claimToken == @claimToken UPDATE migration WITH { claimExpiresAt: @claimExpiresAt } IN ${MIGRATIONS_COLLECTION} RETURN true`, { id: migration.id, claimToken, claimExpiresAt: renewedUntil });
        if (await renewed.next() !== true) claimLost = true;
      }).catch(() => { claimLost = true; });
    }, MIGRATION_HEARTBEAT_MS);
    try {
      await migration.up(database as Database);
      clearInterval(heartbeat);
      await renewal;
      if (claimLost) throw new Error(`Graph migration ${migration.id} lost its claim while running.`);
      const completion = await database.query(`FOR migration IN ${MIGRATIONS_COLLECTION} FILTER migration.id == @id && migration.status == "applying" && migration.claimToken == @claimToken UPDATE migration WITH { status: "applied", appliedAt: @appliedAt, claimToken: null, claimedAt: null, claimExpiresAt: null } IN ${MIGRATIONS_COLLECTION} OPTIONS { keepNull: false } RETURN true`, { id: migration.id, claimToken, appliedAt: now().toISOString() });
      if (await completion.next() !== true) throw new Error(`Graph migration ${migration.id} lost its claim before completion.`);
    } catch (error) {
      clearInterval(heartbeat);
      await renewal;
      await database.query(`FOR migration IN ${MIGRATIONS_COLLECTION} FILTER migration.id == @id && migration.status == "applying" && migration.claimToken == @claimToken UPDATE migration WITH { status: "failed", failedAt: @failedAt, claimToken: null, claimedAt: null, claimExpiresAt: null } IN ${MIGRATIONS_COLLECTION} OPTIONS { keepNull: false }`, { id: migration.id, claimToken, failedAt: now().toISOString() }).catch(() => undefined);
      throw error;
    }
    console.log(`Applied graph migration ${migration.id}`);
  }
}

async function main() {
  const url = process.env.ARANGO_URL ?? 'http://127.0.0.1:8529';
  const username = process.env.ARANGO_USERNAME ?? 'root';
  const password = process.env.ARANGO_ROOT_PASSWORD ?? '';
  const databaseName = process.env.ARANGO_DATABASE ?? 'vorinthex';
  const systemDatabase = new Database({ url, auth: { username, password } });
  try {
    const existing = await systemDatabase.listDatabases();
    if (!existing.includes(databaseName)) await systemDatabase.createDatabase(databaseName);
    await runGraphMigrations(systemDatabase.database(databaseName));
  } finally {
    systemDatabase.close();
  }
}

if (import.meta.main) void main().catch((error) => { console.error(error); process.exit(1); });
