import { createHash } from 'node:crypto';
import { z } from 'zod';
import { aql } from 'arangojs';
import { closeProdSshTunnel, loadEnvironment, verifyProdDatabaseConnection, type EnvironmentName } from './lib/environment';

const argumentsSchema = z.object({
  environment: z.enum(['dev', 'prod']),
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  execute: z.boolean(),
  expectedUserKey: z.string().optional(),
  expectedManifestHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).superRefine((value, context) => {
  if (!value.execute) return;
  if (!value.expectedUserKey) context.addIssue({ code: z.ZodIssueCode.custom, message: '--expected-user-key is required with --execute' });
  if (!value.expectedManifestHash) context.addIssue({ code: z.ZodIssueCode.custom, message: '--expected-manifest-hash is required with --execute' });
});

function readArguments() {
  const values = new Map<string, string>();
  let execute = false;
  for (const argument of process.argv.slice(2)) {
    if (argument === '--execute') {
      execute = true;
      continue;
    }
    const separator = argument.indexOf('=');
    if (!argument.startsWith('--') || separator < 3) throw new Error(`Unsupported argument: ${argument}`);
    values.set(argument.slice(2, separator), argument.slice(separator + 1));
  }
  return argumentsSchema.parse({
    environment: values.get('environment'),
    email: values.get('email'),
    execute,
    expectedUserKey: values.get('expected-user-key'),
    expectedManifestHash: values.get('expected-manifest-hash'),
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

type MatchedDocument = { key: string; storageKey?: string };

async function main() {
  const options = readArguments();
  loadEnvironment(options.environment as EnvironmentName);
  if (options.environment === 'prod') {
    // Keep the maintenance tunnel separate from a local development ArangoDB.
    process.env.PROD_ARANGO_LOCAL_PORT = '18529';
    await verifyProdDatabaseConnection();
  }

  const { db, withTransaction } = await import('@/lib/db/client');
  const { hashUserEmail } = await import('@/api/users');
  const emailHash = await hashUserEmail(options.email);
  const users = await (await db.query(aql`
    FOR user IN users
      FILTER LOWER(TRIM(user.email)) == ${options.email}
      RETURN { key: user._key, email: user.email, emailHashMatches: user.emailHash == ${emailHash} }
  `)).all() as { key: string; email: string; emailHashMatches: boolean }[];
  if (users.length !== 1) {
    const localPart = options.email.split('@')[0]!;
    const candidates = await (await db.query(aql`
      FOR user IN users
        FILTER STARTS_WITH(LOWER(TRIM(user.email)), ${`${localPart}@`})
        RETURN user.email
    `)).all() as string[];
    console.log(JSON.stringify({ exactMatches: users.length, sameLocalPartCandidates: candidates.sort() }, null, 2));
    throw new Error(`Expected exactly one exact account match, found ${users.length}.`);
  }
  const user = users[0]!;

  const memberships = await (await db.query(aql`
    FOR membership IN userOrganizations
      FILTER membership.userId == ${user.key}
      LET organization = DOCUMENT("organizations", membership.organizationId)
      LET otherMembers = LENGTH(
        FOR candidate IN userOrganizations
          FILTER candidate.organizationId == membership.organizationId
            && candidate.userId != ${user.key}
            && candidate.status == "active"
          RETURN 1
      )
      RETURN {
        key: membership._key,
        organizationKey: membership.organizationId,
        organizationName: organization.name,
        personalOwnerUserId: organization.personalOwnerUserId,
        otherMembers
      }
  `)).all() as { key: string; organizationKey: string; organizationName: string; personalOwnerUserId?: string; otherMembers: number }[];
  const unsafeMemberships = memberships.filter(({ personalOwnerUserId, otherMembers }) => personalOwnerUserId !== user.key || otherMembers > 0);
  if (unsafeMemberships.length) {
    console.log(JSON.stringify({ userKey: user.key, blockedMemberships: unsafeMemberships }, null, 2));
    throw new Error('Account belongs to a shared or non-exclusive organization; automatic deletion is blocked.');
  }

  const personalOrganizations = await (await db.query(aql`
    FOR organization IN organizations
      FILTER organization.personalOwnerUserId == ${user.key}
      LET otherMembers = LENGTH(
        FOR membership IN userOrganizations
          FILTER membership.organizationId == organization._key
            && membership.userId != ${user.key}
            && membership.status == "active"
          RETURN 1
      )
      RETURN { key: organization._key, otherMembers }
  `)).all() as { key: string; otherMembers: number }[];
  if (personalOrganizations.some(({ otherMembers }) => otherMembers > 0)) {
    throw new Error('A personal organization contains another active member; automatic deletion is blocked.');
  }
  const organizationKeys = [...new Set([
    ...memberships.map(({ organizationKey }) => organizationKey),
    ...personalOrganizations.map(({ key }) => key),
  ])];
  const membershipKeys = memberships.map(({ key }) => key);
  const scopeKeys = organizationKeys.length ? await (await db.query(aql`
    FOR scope IN scopes
      FILTER scope.organizationKey IN ${organizationKeys}
      RETURN scope._key
  `)).all() as string[] : [];
  const agentKeys = await (await db.query(aql`
    FOR agent IN agents
      FILTER agent.personalOwnerUserId == ${user.key} || agent.scopeKey IN ${scopeKeys}
      RETURN agent._key
  `)).all() as string[];

  const collections = (await db.listCollections())
    .map(({ name }) => name)
    .filter((name) => !name.startsWith('_'))
    .sort();
  const targetKeys = new Set([user.key, emailHash, ...organizationKeys, ...membershipKeys, ...scopeKeys, ...agentKeys]);
  const matched = new Map<string, Map<string, MatchedDocument>>();

  let discovered = true;
  while (discovered) {
    discovered = false;
    const keys = [...targetKeys];
    for (const collectionName of collections) {
      const documents = await (await db.query(aql`
        FOR document IN ${db.collection(collectionName)}
          LET values = VALUES(document, true)
          FILTER document._key IN ${keys}
            || LENGTH(FOR value IN values FILTER value IN ${keys} LIMIT 1 RETURN 1) > 0
            || LENGTH(FOR value IN values FILTER IS_ARRAY(value) && LENGTH(INTERSECTION(value, ${keys})) > 0 LIMIT 1 RETURN 1) > 0
          RETURN { key: document._key, storageKey: IS_STRING(document.storageKey) ? document.storageKey : null }
      `)).all() as { key: string; storageKey: string | null }[];
      if (!documents.length) continue;
      const collectionMatches = matched.get(collectionName) ?? new Map<string, MatchedDocument>();
      matched.set(collectionName, collectionMatches);
      for (const document of documents) {
        collectionMatches.set(document.key, { key: document.key, ...(document.storageKey ? { storageKey: document.storageKey } : {}) });
        if (!targetKeys.has(document.key)) {
          targetKeys.add(document.key);
          discovered = true;
        }
      }
    }
  }

  const affectedCollections = [...matched.entries()]
    .map(([name, documents]) => ({ name, keys: [...documents.keys()].sort(), count: documents.size }))
    .sort(({ name: left }, { name: right }) => left.localeCompare(right));
  const storageKeys = [...new Set([...matched.values()].flatMap((documents) => [...documents.values()].flatMap(({ storageKey }) => storageKey ? [storageKey] : [])))].sort();
  const manifest = {
    emailHash,
    storedEmailHashMatches: user.emailHashMatches,
    userKey: user.key,
    memberships: memberships.map(({ key, organizationKey, organizationName, otherMembers }) => ({ key, organizationKey, organizationName, otherMembers })),
    scopeKeys: [...scopeKeys].sort(),
    agentKeys: [...agentKeys].sort(),
    affectedCollections,
    storageKeys,
  };
  const manifestHash = createHash('sha256').update(stableJson(manifest)).digest('hex');
  console.log(JSON.stringify({ ...manifest, manifestHash, mode: options.execute ? 'execute' : 'preview' }, null, 2));

  if (!options.execute) return;
  if (options.expectedUserKey !== user.key) throw new Error('The expected user key does not match the previewed account.');
  if (options.expectedManifestHash !== manifestHash) throw new Error('The account manifest changed after preview; execution is blocked.');

  const { documentStorage } = await import('@/lib/ai/document-processing/storage');
  for (const storageKey of storageKeys) await documentStorage.delete(storageKey);
  const writeCollections = affectedCollections.map(({ name }) => name);
  await withTransaction(writeCollections, async (transaction) => {
    for (const { name, keys } of affectedCollections) {
      await transaction.query(aql`
        FOR document IN ${db.collection(name)}
          FILTER document._key IN ${keys}
          REMOVE document IN ${db.collection(name)}
      `);
    }
  });
  const remaining = await (await db.query(aql`
    FOR user IN users
      FILTER user._key == ${user.key} || user.emailHash == ${emailHash}
      RETURN 1
  `)).all();
  if (remaining.length) throw new Error('Deletion verification failed: the user identity still exists.');
  console.log(`Deleted account ${user.key}; ${affectedCollections.reduce((sum, item) => sum + item.count, 0)} database documents and ${storageKeys.length} storage objects removed.`);
}

try {
  await main();
} finally {
  try {
    const { closeDb } = await import('@/lib/db/client');
    await closeDb();
  } catch {
    // The database module may not have initialized.
  }
  closeProdSshTunnel();
}
