# Members & Super Admins — Independent Identity Design

Status: implemented in backend and web auth flow.
Scope: `backend/` plus web auth-flow proxy/UI pieces.

Implementation note: waitlist email verification still uses `identityType: "user"` because it verifies a public waitlist profile. Member and super admin sign-in use independent `identityType: "member"` / `identityType: "superAdmin"` identities with no `users` foreign key.

## Why

Today `members` and `superAdmins` are shadow records keyed off `users.key`
(`userId` foreign key). In practice `members` is auto-created for every
regular product signup (`createUserWithAuth` / waitlist), which conflates
"customer profile" with "authenticated staff/admin identity." We're splitting
these apart:

- `users` — pure product/waitlist profile data (name, waitlist number,
  subscriptions, etc). No login happens against it anymore.
- `members` — a fully independent, self-contained login identity (own key,
  own MFA/session state). Not linked to `users` in any way.
- `superAdmins` — same as `members`: fully independent login identity, own
  MFA/session state, not linked to `users` or `members`.

Both `members` and `superAdmins` log in through the **same public endpoints**
(`/auth/login`, `/auth/magic/validate`, `/auth/totp/*`, `/auth/refresh`). The
server figures out which collection an email belongs to at login time.

Backward compatibility note: there is no real member/superAdmin data in
production yet (`environments/backend/db.seeds.secrets.json` is `{}`), so no
data-migration script is needed — only schema/index changes.

## Decisions made (in order)

1. Shared login endpoints for both members and superAdmins (not separate
   admin-only routes).
2. MFA/session fields (`isMfaEnabled`, `has_request_mfa_reset_link`,
   `refreshTokenHash`, `totpSecret`, `lastTotpTimeStep`,
   `requested_mfa_reset_link_at`, `lastLoginAt`) live independently on **both**
   `members` and `superAdmins` — not centralized on `users`.
3. `userId` removed entirely from both `members` and `superAdmins` schemas.
   Each collection's own `key` **is** the auth identity. JWT `sub` = that key.
4. A single email address may only exist in **one** of `members` /
   `superAdmins` — enforced at write time (upsert), not just at seed time.
5. Both `members` and `superAdmins` require `platformId`, resolved to the
   platform named `"this"` (the app's single default platform).
6. `superAdmins.memberId` is removed — no more member↔superAdmin linkage of
   any kind; a super admin does not need to also be a member.
7. Waitlist signup (`platform/waitlist.ts`) and direct signup
   (`/auth/signup` → `createUserWithAuth`) both only create a `users` row.
   Neither auto-creates a `members` row anymore.
8. Becoming a member is a separate, explicit action: either
   `acceptWaitlistUser` (admin approves a pending waitlist user → creates an
   independent `members` row, copying email/name/profileUrl but with no FK),
   or the seed script (`backend/scripts/seed-secrets.ts`).
9. `/auth/signup` no longer grants an immediate login identity — consistent
   with the waitlist path (both just create a `users` profile row).

## 1. Schema changes

### `backend/src/lib/db/members.node.ts`

Remove `userId`. Resulting shape:

```ts
export const memberSchema = z.object({
  key: z.string(),
  platformId: z.string(),
  email: z.string(),
  emailHash: z.string(),
  name: z.string().nullable().default(null),
  profileUrl: z.string().nullable().default(null),
  role: memberRoleSchema.default('viewer'),
  isMfaEnabled: z.boolean().default(false),
  has_request_mfa_reset_link: z.boolean().default(false),
  refreshTokenHash: z.string().nullable().default(null),
  totpSecret: z.string().nullable().default(null),
  lastTotpTimeStep: z.number().nullable().default(null),
  requested_mfa_reset_link_at: z.string().nullable().default(null),
  lastLoginAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});
```

Drop `getMemberByUserId`. Keep `getMemberByEmail`, `getMemberByEmailHash`,
`getMemberByRefreshTokenHash`.

### `backend/src/lib/db/super-admins.node.ts`

Remove `userId` and `memberId`. Add `platformId` and the same MFA/session
fields as members:

```ts
export const superAdminSchema = z.object({
  key: z.string(),
  platformId: z.string(),
  email: z.string(),
  emailHash: z.string(),
  isMfaEnabled: z.boolean().default(false),
  has_request_mfa_reset_link: z.boolean().default(false),
  refreshTokenHash: z.string().nullable().default(null),
  totpSecret: z.string().nullable().default(null),
  lastTotpTimeStep: z.number().nullable().default(null),
  requested_mfa_reset_link_at: z.string().nullable().default(null),
  lastLoginAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});
```

Drop `getSuperAdminByUserId`. Add `getSuperAdminByEmail` and
`getSuperAdminByRefreshTokenHash` (mirroring members). Keep
`getSuperAdminByEmailHash`; `getSuperAdminById` (generic `.getById`) becomes
the primary lookup by identity key.

### `backend/src/lib/db/auth-challenges.node.ts`

`userId` → `identityKey` (generic — could be a member key or superAdmin
key). Add `identityType: z.enum(['member', 'superAdmin'])`:

```ts
export const authChallengeSchema = z.object({
  key: z.string(),
  identityKey: z.string(),
  identityType: z.enum(['member', 'superAdmin']),
  kind: z.string(), // 'email' | 'totp' | 'waitlist' — unrelated to identityType
  tokenHash: z.string(),
  expiresAt: z.string(),
  consumedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  embedding: z.array(z.number()).default([]),
});
```

`listAuthChallengesByUserAndKind` / `consumeActiveAuthChallengesByUserAndKind`
take `(identityKey, identityType, kind)` instead of `(userId, kind)`.

## 2. Cross-collection email uniqueness guard

New file `backend/src/lib/db/identity-guard.ts` (kept separate from both node
files to avoid a circular import between `members.node.ts` and
`super-admins.node.ts`):

```ts
import { getMemberByEmailHash, upsertMemberByKey as rawUpsertMemberByKey } from './members.node';
import { getSuperAdminByEmailHash, upsertSuperAdminByKey as rawUpsertSuperAdminByKey } from './super-admins.node';

export async function upsertMemberByKeyGuarded(input: Record<string, unknown>) {
  const existing = await getSuperAdminByEmailHash(input.emailHash as string);
  if (existing) throw new Error(`email is already registered as a super admin`);
  return rawUpsertMemberByKey(input as Parameters<typeof rawUpsertMemberByKey>[0]);
}

export async function upsertSuperAdminByKeyGuarded(input: Record<string, unknown>) {
  const existing = await getMemberByEmailHash(input.emailHash as string);
  if (existing) throw new Error(`email is already registered as a member`);
  return rawUpsertSuperAdminByKey(input as Parameters<typeof rawUpsertSuperAdminByKey>[0]);
}
```

`backend/src/lib/db/registry.ts` — `NODE_REGISTRY.members` and
`NODE_REGISTRY.superAdmins` use the guarded upserts instead of the raw ones,
so every entry point (seed script, `acceptWaitlistUser`, any future
admin-created member/superAdmin) gets the check for free.

Known gap: the generic `.insert` / `.updateById` helpers on both node types
bypass this guard (only `upsertByKey` goes through the registry). Not
currently used anywhere in the codebase for members/superAdmins, so
acceptable for now — flag if a new caller shows up.

## 3. `backend/src/api/auth.ts` — identity abstraction

To avoid duplicating the ~150 lines of TOTP/email-challenge/refresh-token
logic once per collection, introduce a small internal abstraction:

```ts
type IdentityType = 'member' | 'superAdmin';

interface Identity {
  type: IdentityType;
  key: string;
  email: string;
  emailHash: string;
  isMfaEnabled: boolean;
  has_request_mfa_reset_link: boolean;
  requested_mfa_reset_link_at: string | null;
  totpSecret: string | null;
  lastTotpTimeStep: number | null;
}

async function findIdentityByEmail(email: string): Promise<Identity | null> {
  const [member, superAdmin] = await Promise.all([
    getMemberByEmail(email),
    getSuperAdminByEmail(email),
  ]);
  if (member && superAdmin) throw new Error(`email exists as both a member and a super admin — data integrity bug`);
  if (member) return { type: 'member', ...member };
  if (superAdmin) return { type: 'superAdmin', ...superAdmin };
  return null;
}

async function getIdentity(type: IdentityType, key: string): Promise<Identity | null> { /* getMemberById or getSuperAdminById */ }
async function updateIdentity(type: IdentityType, key: string, patch: Record<string, unknown>): Promise<void> { /* updateMember or updateSuperAdmin */ }
async function getIdentityByRefreshTokenHash(tokenHash: string): Promise<Identity | null> { /* checks both */ }
```

Rewire every exported function to go through this abstraction instead of
hardcoding `members.node.ts` calls:

- `requestSignInEmail`, `requestMfaResetEmail` — `findIdentityByEmail`
  instead of `getMemberByEmail`.
- `createChallenge(identityKey, identityType, kind, ttlMs)` — new
  `identityType` param, stored on the challenge.
- `validateMagicLink`, `startTotpSetup`, `completeTotpSetup`,
  `verifyTotpAndIssueSession` — read `challenge.identityType` +
  `challenge.identityKey`, call `getIdentity`/`updateIdentity` generically.
  **Drop** the `updateUser(...)` / `getUserById(...)` calls in these
  functions — there's no `users` row to touch anymore.
- `issueTokens(identity)` — `updateIdentity(identity.type, identity.key, { refreshTokenHash, ... })`.
  Drop the `updateUser` call.
- `rotateRefreshToken` — `getIdentityByRefreshTokenHash` instead of
  `getMemberByRefreshTokenHash`.
- **JWT payload** becomes `{ sub: identity.key, identityType, iat, exp }`
  instead of `{ sub: userId }`. `createAccessToken(identity)` /
  `verifyAccessToken` return/accept `{ key, identityType }`.
- `createUserWithAuth` (backing `/auth/signup`) — remove the
  `upsertMemberForUser(user)` call. Returns just `{ userId: user.key }` (a
  `users` row only, same as waitlist signup).

- [x] `backend/src/api/security.ts` - auth identity support; `getUserId` remains public-user only

`getUserId(c)` → rename/extend to return `{ key, identityType } | null`
(decodes the JWT's `sub` + `identityType` claims instead of just `sub`).

`requireSuperAdmin` in `system.ts` simplifies to:

```ts
async function requireSuperAdmin(c: Context) {
  const auth = await requireUserId(c); // now returns {identityType, key}
  if ('error' in auth) return auth;
  if (auth.identityType !== 'superAdmin') {
    return { error: c.json({ error: 'super admin required' }, 403) };
  }
  const superAdmin = await getSuperAdminById(auth.key);
  if (!superAdmin) return { error: c.json({ error: 'super admin required' }, 403) };
  return { key: auth.key, superAdmin };
}
```

Note: `requireUserId`-gated routes elsewhere in `system.ts` (minds,
orchestrators-as-viewed-by-regular-users, etc.) are for **regular product
users** (`users` collection, via `defaultMindStoragePath: users/${userId}/mind`)
— unaffected by this change, they don't go through `requireSuperAdmin`.

## 5. Waitlist / signup flow

`backend/src/api/users.ts`
- Remove `upsertMemberForUser` entirely (was FK-based, no longer valid).

- [x] `backend/src/platform/waitlist.ts` - emailHash-based pending check, independent member creation
- `listPendingWaitlistUsers()` — join condition changes from
  `m.userId == u._key` to `m.emailHash == u.emailHash` (no FK to match on
  anymore).
- `acceptWaitlistUser(userId)` — replace `upsertMemberForUser(entry)` with a
  new `createMemberFromWaitlistUser(entry)` (defined in this file or next to
  the guard) that creates a **fully independent** member: fresh generated
  `key`, `platformId` resolved to `"this"`, copies `email`/`name`/
  `profileUrl` from the waitlist user, and goes through
  `upsertMemberByKeyGuarded` so the email-collision rule applies here too.

## 6. `backend/src/db/arango-migrate.ts`

Index spec changes:

```ts
{
  name: 'members',
  indexes: [
    { fields: ['platformId'] },
    { fields: ['platformId', 'role'] },
    { fields: ['email'], unique: true },
    { fields: ['emailHash'], unique: true },
    { fields: ['refreshTokenHash'], unique: true, sparse: true },
  ],
},
{
  name: 'superAdmins',
  indexes: [
    { fields: ['platformId'] },
    { fields: ['email'], unique: true },
    { fields: ['emailHash'], unique: true },
    { fields: ['refreshTokenHash'], unique: true, sparse: true },
  ],
},
{
  name: 'authChallenges',
  indexes: [
    { fields: ['tokenHash'], unique: true },
    { fields: ['identityKey', 'identityType', 'kind'] },
    { fields: ['expiresAt'] },
  ],
},
```

(Dropped: `members.userId` unique index, `superAdmins.userId` unique index,
`superAdmins.memberId` unique+sparse index.)

Remove the dead legacy migration block (~lines 278–405) that promotes old
`users.isSuperAdmin` / `users.isMfaEnabled` flags into `members`/
`superAdmins` using the old `userId`/`memberId` shape — it's a no-op today
(current `userSchema` doesn't declare those fields) and would otherwise
write documents in the now-invalid old shape. Remove the
now-orphaned `buildMemberEmbedText` / `buildSuperAdminEmbedText` helpers if
nothing else references them after that block is gone.

## 7. `backend/scripts/seed-secrets.ts`

- Add `'superAdmins'` to the `NODES_WITH_PLATFORM_ID` set (it now requires
  `platformId` too, resolved the same way as members: check the seed file's
  own `platforms` entry named `"this"` first, else `getDefaultPlatformId()`).
- Add auto-fill for `createdAt`/`updatedAt` (current ISO timestamp) when
  omitted from a doc, so the seed file can be just:

```json
{
  "superAdmins": [
    { "email": "admin@vorinthex.com", "name": "Admin" }
  ],
  "members": [
    { "email": "member1@vorinthex.com", "name": "Member One", "role": "admin" },
    { "email": "member2@vorinthex.com", "name": "Member Two", "role": "moderator" },
    { "email": "member3@vorinthex.com", "name": "Member Three", "role": "viewer" }
  ]
}
```

(No `key`, `userId`, `platformId`, `emailHash`, or timestamps needed — all
auto-generated/auto-resolved by the script.)

## 8. Testing

- Update fixtures in any `*.test.ts` that construct `members`/`superAdmins`
  docs with `userId`/`memberId` — those fields no longer exist.
- New test: create a `member` with an email, then attempt to create a
  `superAdmin` with the same email → must throw (guard).
- New test: `requireSuperAdmin` accepts a superAdmin-issued JWT without any
  matching `members` row, and rejects a member-issued JWT.
- New/updated auth flow tests: `findIdentityByEmail` resolves the right
  `identityType`; JWT round-trip carries `identityType` correctly.
- Run `bun run backend:check` and `bun run backend:test` after each file
  group, not just at the end.

## Files touched (implementation checklist)

- [x] `backend/src/lib/db/members.node.ts` — drop `userId`
- [x] `backend/src/lib/db/super-admins.node.ts` — drop `userId`/`memberId`, add `platformId` + MFA fields, new lookups
- [x] `backend/src/lib/db/identity-guard.ts` — new file, cross-collection email guard
- [x] `backend/src/lib/db/registry.ts` — wire guarded upserts for members/superAdmins
- [x] `backend/src/lib/db/auth-challenges.node.ts` — `identityKey` + `identityType`
- [x] `backend/src/api/auth.ts` — identity abstraction, JWT shape, drop `users` touches
- [x] `backend/src/api/security.ts` - auth identity support; `getUserId` remains public-user only
- [x] `backend/src/api/system.ts` — simplified `requireSuperAdmin`
- [x] `backend/src/api/users.ts` — remove `upsertMemberForUser`
- [x] `backend/src/platform/waitlist.ts` - emailHash-based pending check, independent member creation
- [x] `backend/src/db/arango-migrate.ts` — index updates, remove dead legacy block
- [x] `backend/scripts/seed-secrets.ts` — `superAdmins` in platform auto-fill set, timestamp auto-fill
- [x] Test fixture updates
- [x] `bun run backend:check` && `bun run backend:test` clean
