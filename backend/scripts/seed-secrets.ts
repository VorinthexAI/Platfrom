import { readFileSync } from 'node:fs';
import { closeDb } from '@/lib/db/client';
import { NODE_REGISTRY, NODE_NAMES } from '@/lib/db/registry';
import { newId } from '@/lib/ids';
import { getDefaultPlatformId } from '@/platform/events';
import { normalizeEmail } from '@/api/users';
import { sha256 } from '@/lib/crypto';
import { getUserByEmailHash } from '@/lib/db/users.node';

const SEEDS_FILE = process.env.SEEDS_FILE ?? '../environments/backend/db.seeds.secrets.json';

// These are the only node schemas with a required (non-nullable) platformId.
const NODES_WITH_PLATFORM_ID = new Set(['users']);

/** Same derivation the app uses at signup (see hashUserEmail in api/users.ts) — kept local so seed docs only need a plaintext "email". */
function generateEmailHash(email: string): Promise<string> {
  return sha256(normalizeEmail(email));
}

function generateCuidKey(): string {
  return newId();
}

async function existingIdentity(nodeName: string, emailHash: unknown): Promise<Record<string, unknown> | null> {
  if (typeof emailHash !== 'string' || emailHash.length === 0) return null;
  if (nodeName === 'users') return (await getUserByEmailHash(emailHash)) ?? null;
  return null;
}

function resolveRefs(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === 'string' && value.startsWith('$ref:')) {
    const alias = value.slice('$ref:'.length);
    const resolved = idMap.get(alias);
    if (!resolved) throw new Error(`Unresolved "$ref:${alias}" — no earlier document in this file declared "$id": "${alias}".`);
    return resolved;
  }
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, idMap));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolveRefs(v, idMap)]));
  }
  return value;
}

async function main() {
  const raw = readFileSync(SEEDS_FILE, 'utf8');
  const seeds: unknown = JSON.parse(raw);
  if (typeof seeds !== 'object' || seeds === null || Array.isArray(seeds)) {
    throw new Error(`${SEEDS_FILE} must be a JSON object of "nodeName": [documents].`);
  }

  const idMap = new Map<string, string>();
  let defaultPlatformId: string | null = null;
  const results: { node: string; key: string }[] = [];

  for (const [nodeName, docs] of Object.entries(seeds as Record<string, unknown>)) {
    const accessor = NODE_REGISTRY[nodeName];
    if (!accessor) {
      // Seeds files can outlive schema migrations (e.g. the retired
      // superAdmins node) — skip loudly instead of failing the deploy.
      console.warn(`Skipping unknown node "${nodeName}" in ${SEEDS_FILE}. Valid nodes: ${NODE_NAMES.join(', ')}`);
      continue;
    }
    if (!Array.isArray(docs)) {
      throw new Error(`Node "${nodeName}" in ${SEEDS_FILE} must map to an array of documents.`);
    }

    for (const rawDoc of docs) {
      const doc = { ...(rawDoc as Record<string, unknown>) };
      const localId = doc.$id as string | undefined;
      delete doc.$id;

      if (typeof doc.email === 'string' && !doc.emailHash) {
        doc.emailHash = await generateEmailHash(doc.email);
      }
      const now = new Date().toISOString();
      const existing = await existingIdentity(nodeName, doc.emailHash);
      if (existing) {
        // upsertByKey saves a FULL replacement, so merge over the live doc:
        // a seed entry updates only the fields it declares and never wipes
        // account state (MFA secret, alias, waitlist number, sessions, …).
        const seeded = { ...doc };
        Object.assign(doc, existing, seeded);
        doc.key = existing.key;
        doc.updatedAt = now;
      } else {
        doc.key = doc.key ?? generateCuidKey();
      }
      if (!doc.createdAt) doc.createdAt = now;
      if (!doc.updatedAt) doc.updatedAt = now;
      if (NODES_WITH_PLATFORM_ID.has(nodeName) && !doc.platformId) {
        defaultPlatformId ??= await getDefaultPlatformId();
        doc.platformId = defaultPlatformId;
      }

      const resolved = resolveRefs(doc, idMap) as Record<string, unknown>;
      const saved = (await accessor.upsertByKey(resolved as never)) as { key: string };
      results.push({ node: nodeName, key: saved.key });

      if (localId) idMap.set(localId, saved.key);
      if (nodeName === 'platforms' && resolved.name === 'this') defaultPlatformId = saved.key;
    }
  }

  console.table(results);
  console.log(`\nUpserted ${results.length} document${results.length === 1 ? '' : 's'} across ${Object.keys(seeds as object).length} node${Object.keys(seeds as object).length === 1 ? '' : 's'}.`);
}

try {
  await main();
} finally {
  await closeDb();
}
