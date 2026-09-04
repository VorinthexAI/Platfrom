import { z } from 'zod';
import { getUserByAliasSlug, getUserByEmailHash, getUserById, initializeUserNameIfMissing, insertUser, updateUser, type User } from '@/lib/db/users.node';
import { provisionPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { getVisitorByDistinctId, type Visitor } from '@/lib/db/visitors.node';
import { isArangoUniqueConstraintError } from '@/lib/db/base';
import { ALIAS_SLUG_PREFIX_SPACE, generateAlias, generateAliasSlug } from '@/lib/alias';
import { sha256 } from '@/lib/crypto';
import { newId } from '@/lib/ids';
import { getRootOrganizationId } from '@/lib/db/organizations.node';
import { APP_KEYS } from '@/lib/apps/registry';
import { toolEventService } from '@/lib/ai/events/service';
import { sparkService } from '@/lib/sparks/service';
import { ACCOUNT_GRANT_MICRO_SPARKS } from '@/lib/costs';

export function newcomerGrantInput(eventKey: string) {
  return {
    deltaMicroSparks: ACCOUNT_GRANT_MICRO_SPARKS,
    idempotencyKey: 'account-grant:v2',
    requestHash: 'account-grant:v2:100-sparks',
    eventKey,
    metadata: { category: 'newcomer-grant', grantVersion: 'v2' },
  } as const;
}

async function initializeNewAccount(user: User): Promise<User> {
  const grant = await sparkService.adjust(user.key, newcomerGrantInput(newId()));
  if (grant.status === 'conflict') throw new Error(`Spark account initialization conflicted for user ${user.key}.`);
  await recordAccountCreatedEvent(user, grant.transaction);
  return await getUserById(user.key) ?? user;
}

async function recordAccountCreatedEvent(user: User, transaction: { key: string; eventKey?: string; deltaMicroSparks: number }) {
  const eventKey = transaction.eventKey;
  if (!eventKey) throw new Error(`Spark account initialization did not retain an event key for user ${user.key}.`);
  await toolEventService.record({
    userId: user.key,
    scopeKey: user.currentScopeKey,
    slug: 'account.created',
    appKey: APP_KEYS.CORE,
    status: 'completed',
    microSparks: transaction.deltaMicroSparks,
    sparkTransactionKey: transaction.key,
  }, { key: eventKey });
}

async function recoverNewcomerGrantEvent(user: User) {
  const transaction = (await sparkService.listHistory(user.key, { limit: 200 })).find(({ idempotencyKey }) => idempotencyKey === 'account-grant:v2');
  if (transaction) await recordAccountCreatedEvent(user, transaction);
}

export function normalizeEmail(email: string) {
  return z.string().email().parse(email.trim().toLowerCase());
}

export function defaultNameFromEmail(email: string) {
  const localPart = email.trim().split('@')[0] ?? '';
  const firstName = (localPart.split('.')[0] ?? localPart).replace(/[^a-zA-Z'-]/g, '');
  if (!firstName) return null;
  return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

export async function hashUserEmail(email: string) {
  return sha256(normalizeEmail(email));
}

/**
 * The anonymous visitor node this signup has been exploring the galaxy as.
 * Visitors are anonymous by definition now (no emailHash/userId), so the
 * only durable link at conversion is the distinct-id cookie — used purely
 * to carry the explorer's alias over onto the new user.
 */
async function findVisitorForConversion(distinctId: string | null): Promise<Visitor | null> {
  return distinctId ? getVisitorByDistinctId(distinctId) : null;
}

async function createUniqueAliasSlug(alias: string, userKey: string): Promise<string> {
  for (let attempt = 0; attempt < ALIAS_SLUG_PREFIX_SPACE; attempt += 1) {
    const candidate = generateAliasSlug(alias, userKey, attempt);
    const existing = await getUserByAliasSlug(candidate);
    if (!existing || existing.key === userKey) return candidate;
  }
  throw new Error(`Could not allocate alias_slug for user ${userKey}`);
}

export async function upsertUserByEmail(
  email: string,
  values: Partial<Omit<User, 'key' | 'email' | 'emailHash'>> = {},
  options: { distinctId?: string | null; initializeNameOnly?: boolean } = {},
): Promise<User> {
  const normalized = normalizeEmail(email);
  const emailHash = await hashUserEmail(normalized);
  const now = new Date().toISOString();
  const organizationId = values.organizationId ?? await getRootOrganizationId();
  // The alias travels: whoever explored the galaxy as this anonymous visitor
  // keeps the same "<Prefix> <Role>" identity when they become a user.
  const visitor = await findVisitorForConversion(options.distinctId ?? null);

  async function reconcileWithExisting(existing: User): Promise<User> {
    const patch: Partial<User> = { ...values, organizationId, email: normalized, emailHash, updatedAt: now };
    const initialName = options.initializeNameOnly && typeof patch.name === 'string' ? patch.name : null;
    if (options.initializeNameOnly) delete patch.name;
    // Country is captured at account creation, not rewritten by later sign-ins.
    delete patch.countryCode;
    if (existing.guestBootstrapSecretHash) delete patch.guestBootstrapSecretHash;
    if (patch.name === undefined) delete patch.name;
    if (patch.alias === undefined && existing.alias == null && visitor?.alias) {
      patch.alias = visitor.alias;
    }
    const alias = patch.alias ?? existing.alias ?? generateAlias(existing.key);
    if (existing.alias == null && patch.alias === undefined) {
      patch.alias = alias;
    }
    if (patch.alias_slug === undefined && existing.alias_slug == null) {
      patch.alias_slug = await createUniqueAliasSlug(alias, existing.key);
    }
    const updated = await updateUser(existing.key, patch);
    const named = initialName ? await initializeUserNameIfMissing(updated.key, initialName, now) ?? updated : updated;
    await provisionPersonalAuthContext(named);
    const reconciled = await getUserById(named.key) ?? named;
    await recoverNewcomerGrantEvent(reconciled);
    return reconciled;
  }

  const existing = await getUserByEmailHash(emailHash);
  if (existing) return reconcileWithExisting(existing);

  const key = newId();
  const currentScopeKey = newId();
  const alias = values.alias ?? visitor?.alias ?? generateAlias(key);
  try {
    const user = await insertUser({
      key,
      currentScopeKey,
      ...values,
      organizationId,
      email: normalized,
      emailHash,
      name: values.name ?? defaultNameFromEmail(normalized),
      alias,
      alias_slug: values.alias_slug ?? await createUniqueAliasSlug(alias, key),
      createdAt: now,
      updatedAt: now,
    });
    await provisionPersonalAuthContext(user, { mainScopeKey: currentScopeKey });
    return initializeNewAccount(await getUserById(user.key) ?? user);
  } catch (err) {
    // Two concurrent upserts for the same brand-new email (a double-tapped
    // "Continue with Google", a retried OAuth callback, or a magic-link
    // request racing an OAuth callback for the same address) can both pass
    // the emailHash lookup above before either has inserted. The unique
    // index on emailHash is the real backstop here — resolve to whichever
    // row won the race instead of surfacing a raw 500.
    if (!isArangoUniqueConstraintError(err)) throw err;
    const winner = await getUserByEmailHash(emailHash);
    if (!winner) throw err;
    return reconcileWithExisting(winner);
  }
}
