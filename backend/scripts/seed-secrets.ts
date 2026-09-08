import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { closeDb, db } from '@/lib/db/client';
import { NODE_REGISTRY, NODE_NAMES } from '@/lib/db/registry';
import { newId } from '@/lib/ids';
import { getRootTeamKey } from '@/lib/db/teams.node';
import { normalizeEmail } from '@/api/users';
import { sha256 } from '@/lib/crypto';
import { getUserByEmailHash } from '@/lib/db/users.node';
import { provisionPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { isProviderError } from '@/lib/ai/providers/errors';
import {
  getUserTeamByTeamAndUser,
  upsertUserTeamByKey,
  type UserTeam,
} from '@/lib/db/user-team.node';
import { enforceRootTeamMfa, ensureSeededActiveRootMembersVerified } from './seed-verification';

const ENVIRONMENTS_JSON_PATH = '../.github/environments.json';

function resolveSeedsFile(): string {
  if (process.env.SEEDS_FILE) return process.env.SEEDS_FILE;
  if (!existsSync(ENVIRONMENTS_JSON_PATH)) return ENVIRONMENTS_JSON_PATH;

  // Local runs: pull secrets.prod.db_seeds out of environments.json into a
  // scratch file so the rest of this script can keep reading a plain
  // { nodeName: [documents] } JSON file, same shape CI's SEEDS_FILE override uses.
  const parsed = JSON.parse(readFileSync(ENVIRONMENTS_JSON_PATH, 'utf8'));
  const dbSeeds = parsed?.secrets?.prod?.db_seeds;
  if (!dbSeeds || typeof dbSeeds !== 'object') return ENVIRONMENTS_JSON_PATH;

  const scratchFile = '.tmp-db-seeds.secrets.json';
  writeFileSync(scratchFile, JSON.stringify(dbSeeds));
  return scratchFile;
}

const SEEDS_FILE = resolveSeedsFile();

// These are the only node schemas with a required (non-nullable) teamKey.
const NODES_WITH_TEAM_KEY = new Set(['users']);

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

function seededMembershipRole(role: unknown): UserTeam['teamRole'] | null {
  if (role === 'owner' || role === 'admin' || role === 'moderator' || role === 'member' || role === 'viewer') return role;
  return null;
}

async function syncSeededTeamMembership(input: {
  userId: string;
  teamKey: unknown;
  teamRole: unknown;
  teamTitle: unknown;
  now: string;
}) {
  const role = seededMembershipRole(input.teamRole);
  if (!role || typeof input.teamKey !== 'string' || !input.teamKey) return null;

  const existing = await getUserTeamByTeamAndUser(
    input.teamKey,
    input.userId,
  );
  const key = existing?.key ?? generateCuidKey();
  return upsertUserTeamByKey({
    ...(existing ?? {}),
    key,
    teamKey: input.teamKey,
    userId: input.userId,
    teamRole: role,
    teamTitle: typeof input.teamTitle === 'string' ? input.teamTitle : existing?.teamTitle ?? null,
    status: 'active',
    environmentSeeded: true,
    joinedAt: existing?.joinedAt ?? input.now,
    isMfaEnabled: existing?.isMfaEnabled ?? false,
    totpSecret: existing?.totpSecret ?? null,
    lastTotpTimeStep: existing?.lastTotpTimeStep ?? null,
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
  });
}

async function main() {
  const raw = readFileSync(SEEDS_FILE, 'utf8');
  const seeds: unknown = JSON.parse(raw);
  if (typeof seeds !== 'object' || seeds === null || Array.isArray(seeds)) {
    throw new Error(`${SEEDS_FILE} must be a JSON object of "nodeName": [documents].`);
  }

  const idMap = new Map<string, string>();
  let rootTeamKey: string | null = null;
  const results: { node: string; key: string }[] = [];
  const seededUserKeys = new Set<string>();
  const authoritativeMemberships = new Map<string, Set<string>>();

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
        // account state (MFA secret, alias, sessions, etc.).
        const seeded = { ...doc };
        Object.assign(doc, existing, seeded);
        doc.key = existing.key;
        doc.updatedAt = now;
      } else {
        doc.key = doc.key ?? generateCuidKey();
      }
      if (!doc.createdAt) doc.createdAt = now;
      if (!doc.updatedAt) doc.updatedAt = now;
      if (NODES_WITH_TEAM_KEY.has(nodeName) && !doc.teamKey) {
        rootTeamKey ??= await getRootTeamKey();
        doc.teamKey = rootTeamKey;
      }
      if (nodeName === 'users' && !doc.currentScopeKey) doc.currentScopeKey = newId();

      let resolved = resolveRefs(doc, idMap) as Record<string, unknown>;
      if (nodeName === 'teams') resolved = enforceRootTeamMfa(resolved);
      const saved = (await accessor.upsertByKey(resolved as never)) as { key: string };
      results.push({ node: nodeName, key: saved.key });

      if (nodeName === 'users') {
        seededUserKeys.add(saved.key);
        await provisionPersonalAuthContext({
          key: saved.key,
          name: typeof resolved.name === 'string' ? resolved.name : null,
          email: String(resolved.email),
          currentScopeKey: String(resolved.currentScopeKey),
        }, { mainScopeKey: existing ? undefined : String(resolved.currentScopeKey) });
        const membership = await syncSeededTeamMembership({
          userId: saved.key,
          teamKey: resolved.teamKey,
          teamRole: resolved.team_role,
          teamTitle: resolved.team_title,
          now,
        });
        if (membership) {
          results.push({ node: 'userTeams', key: membership.key });
          if (process.env.SYNC_SEEDED_TEAM_ROSTER === 'true') {
            const userKeys = authoritativeMemberships.get(membership.teamKey) ?? new Set<string>();
            userKeys.add(membership.userId);
            authoritativeMemberships.set(membership.teamKey, userKeys);
          }
        }
      }

      if (localId) idMap.set(localId, saved.key);
      if (nodeName === 'teams' && resolved.is_root === true) rootTeamKey = saved.key;
    }
  }

  const verifiedRootMemberKeys = await ensureSeededActiveRootMembersVerified(
    [...seededUserKeys],
    new Date().toISOString(),
  );
  for (const key of verifiedRootMemberKeys) results.push({ node: 'users', key });

  if (process.env.SYNC_SEEDED_TEAM_ROSTER === 'true') {
    const cursor = await db.query<string>(`
      FOR membership IN userTeams
        FILTER membership.environmentSeeded == true
        COLLECT teamKey = membership.teamKey
        RETURN teamKey
    `);
    for (const teamKey of await cursor.all()) {
      if (!authoritativeMemberships.has(teamKey)) authoritativeMemberships.set(teamKey, new Set());
    }
  }

  for (const [teamKey, userKeys] of authoritativeMemberships) {
    const cursor = await db.query<number>(`
      LET changed = LENGTH(
        FOR membership IN userTeams
          FILTER membership.teamKey == @teamKey
          FILTER membership.environmentSeeded == true && membership.userId NOT IN @userKeys
          UPDATE membership WITH { status: "inactive", environmentSeeded: false, updatedAt: @now } IN userTeams
          RETURN 1
      )
      RETURN changed
    `, { teamKey, userKeys: [...userKeys], now: new Date().toISOString() });
    console.log(`Deactivated ${await cursor.next() ?? 0} non-seeded team membership(s).`);
  }

  console.table(results);
  console.log(`\nUpserted ${results.length} document${results.length === 1 ? '' : 's'} across ${Object.keys(seeds as object).length} node${Object.keys(seeds as object).length === 1 ? '' : 's'}.`);
}

try {
  await main();
} catch (error) {
  if (!isProviderError(error) || !error.retryable) throw error;
  console.warn(`Secret seed deferred because ${error.providerId} is unavailable (${error.code}).`);
} finally {
  await closeDb();
}
