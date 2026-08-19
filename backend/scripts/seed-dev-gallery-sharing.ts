import { createHash } from 'node:crypto';
import { hashUserEmail } from '@/api/users';
import { decryptAuthenticatedJson, encryptAuthenticatedJson } from '@/lib/authenticated-encryption';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { closeDb, db, withTransaction } from '@/lib/db/client';
import { collectionImageSchema } from '@/lib/db/collection-images.node';
import { collectionInviteSchema, type CollectionInvite } from '@/lib/db/collection-invites.node';
import { collectionMemberSchema, type CollectionMember } from '@/lib/db/collection-members.node';
import { collectionSchema, type Collection } from '@/lib/db/collections.node';
import { getPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { shareSchema, type Share } from '@/lib/db/shares.node';
import { userOrganizationSchema } from '@/lib/db/user-organization.node';
import { getUserByEmailHash, userSchema } from '@/lib/db/users.node';
import {
  assertDevLocalArango,
  buildGallerySharingFixturePlan,
  buildOwnedCollectionFixturePlan,
  buildSharedCollectionPlacementPlan,
  deterministicGalleryEmbedding,
  deterministicGalleryFixtureKey,
  deterministicGalleryToken,
  DEV_GALLERY_SHARING_NOW,
} from './seed-dev-gallery-sharing-fixtures';

const EMAIL = process.env.DEV_SEED_EMAIL?.trim().toLowerCase() || 'oscar.burman005@gmail.com';
const NOW = DEV_GALLERY_SHARING_NOW;
const REVOKED_AT = '2026-08-18T12:30:00.000Z';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const requestHash = (value: unknown) => sha256(JSON.stringify(value));
const document = <T extends { key: string }>(value: T) => toArangoDoc(value);

function safeInvite(invite: CollectionInvite) {
  const { tokenHash: _tokenHash, ...safe } = invite;
  return safe;
}

function safeShare(share: Share, token: string) {
  const { tokenHash: _tokenHash, passwordHash: _passwordHash, ...safe } = share;
  return { ...safe, role: share.permission, active: !share.revokedAt, token, url: `https://vorinthex.com/share/${token}` };
}

async function upsert(transaction: { query(query: string, bindVars?: Record<string, unknown>): Promise<unknown> }, collection: string, value: { key: string }) {
  await transaction.query(`UPSERT { _key: @key } INSERT @document UPDATE {} IN ${collection}`, { key: value.key, document: document(value) });
}

async function main() {
  assertDevLocalArango(process.env);
  const oscar = await getUserByEmailHash(await hashUserEmail(EMAIL));
  if (!oscar) throw new Error(`Dev user ${EMAIL} does not exist. Sign in once before seeding.`);
  const context = await getPersonalAuthContext(oscar.key);
  if (!context) throw new Error(`Personal Gallery context for ${EMAIL} is unavailable.`);

  const scopeKey = context.scope.key;
  const organizationKey = context.organization.key;
  const oscarMembershipKey = context.membership.key;
  const plan = buildGallerySharingFixturePlan(scopeKey);

  const fakeUsers = await Promise.all(plan.identities.map(async (identity, index) => userSchema.parse({
    key: identity.userKey,
    organizationId: organizationKey,
    email: identity.email,
    emailHash: await hashUserEmail(identity.email),
    name: identity.name,
    isVerified: true,
    isOnboarded: true,
    createdAt: NOW,
    updatedAt: NOW,
    embedding: deterministicGalleryEmbedding(100 + index),
  })));
  const fakeMemberships = plan.identities.map((identity, index) => userOrganizationSchema.parse({
    key: identity.membershipKey,
    organizationId: organizationKey,
    userId: identity.userKey,
    orgRole: 'member',
    orgTitle: index === 0 ? 'Photographer' : index === 1 ? 'Curator' : 'Producer',
    status: 'active',
    joinedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    embedding: [],
  }));
  const sharedCollections = plan.collections.map((fixture) => collectionSchema.parse({
    key: fixture.collectionKey,
    scopeKey,
    name: fixture.name,
    description: fixture.description,
    embedding: deterministicGalleryEmbedding(200 + fixture.index),
    isFavorite: false,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }));

  const seeded = await withTransaction({ read: ['images'], write: ['users', 'userOrganizations', 'collections', 'collectionMembers', 'collectionImages', 'collectionInvites', 'shares'] }, async (transaction) => {
    for (const user of fakeUsers) await upsert(transaction, 'users', user);
    for (const membership of fakeMemberships) await upsert(transaction, 'userOrganizations', membership);
    for (const collection of sharedCollections) await upsert(transaction, 'collections', collection);

    for (const fixture of plan.collections) {
      const owner = collectionMemberSchema.parse({ key: fixture.ownerMemberKey, scopeKey, collectionKey: fixture.collectionKey, memberKey: fixture.ownerMembershipKey, role: 'owner', createdAt: NOW });
      const oscarMember = collectionMemberSchema.parse({ key: fixture.oscarMemberKey, scopeKey, collectionKey: fixture.collectionKey, memberKey: oscarMembershipKey, role: fixture.oscarRole, createdAt: NOW });
      await upsert(transaction, 'collectionMembers', owner);
      await upsert(transaction, 'collectionMembers', oscarMember);

      const token = deterministicGalleryToken(scopeKey, 'collection-invite', `${fixture.slug}:oscar`);
      const invite = collectionInviteSchema.parse({ key: fixture.inviteKey, scopeKey, collectionKey: fixture.collectionKey, invitedByKey: fixture.ownerMembershipKey, inviteeKey: oscarMembershipKey, role: fixture.oscarRole, tokenHash: sha256(token), createdAt: NOW, updatedAt: NOW });
      const responseCiphertext = encryptAuthenticatedJson({ invite: safeInvite(invite), token });
      await transaction.query('UPSERT { _key: @key } INSERT MERGE(@document, { requestHash: @requestHash, responseCiphertext: @responseCiphertext }) UPDATE {} IN collectionInvites', {
        key: invite.key,
        document: document(invite),
        requestHash: requestHash({ collectionKey: invite.collectionKey, inviteeKey: invite.inviteeKey, role: invite.role }),
        responseCiphertext,
      });
    }

    const candidateCursor = await transaction.query(`
      FOR image IN images
        FILTER image.scopeKey == @scopeKey && image.deletedAt == null
        LET sourceCollectionKey = FIRST(
          FOR relation IN collectionImages
            FILTER relation.scopeKey == @scopeKey && relation.imageKey == image._key && relation.collectionKey NOT IN @sharedCollectionKeys
            LET source = DOCUMENT(collections, relation.collectionKey)
            FILTER source != null && source.scopeKey == @scopeKey && source.deletedAt == null
            SORT source._key ASC
            RETURN source._key
        )
        SORT sourceCollectionKey == null ASC, sourceCollectionKey ASC, image._key ASC
        RETURN { imageKey: image._key, sourceCollectionKey }
    `, { scopeKey, sharedCollectionKeys: plan.collections.map(({ collectionKey }) => collectionKey) });
    const placementPlan = buildSharedCollectionPlacementPlan(
      scopeKey,
      plan.collections.map(({ collectionKey, ownerMembershipKey }) => ({ collectionKey, ownerMembershipKey })),
      await candidateCursor.all() as Array<{ imageKey: string; sourceCollectionKey: string | null }>,
    );
    for (const target of placementPlan) {
      for (const placement of target.placements) {
        const relation = collectionImageSchema.parse({ key: placement.key, scopeKey, collectionKey: target.collectionKey, imageKey: placement.imageKey, addedByKey: target.ownerMembershipKey, createdAt: NOW });
        await transaction.query('UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey: @imageKey } INSERT @document UPDATE {} IN collectionImages', { scopeKey, collectionKey: relation.collectionKey, imageKey: relation.imageKey, document: document(relation) });
      }
      const firstImageKey = target.placements[0]?.imageKey;
      if (firstImageKey) {
        await transaction.query('FOR collection IN collections FILTER collection._key == @collectionKey && collection.scopeKey == @scopeKey LET validCover = collection.coverImageKey != null && LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == collection._key && relation.imageKey == collection.coverImageKey LIMIT 1 RETURN 1) == 1 UPDATE collection WITH { coverImageKey: validCover ? collection.coverImageKey : @coverImageKey } IN collections RETURN NEW', { scopeKey, collectionKey: target.collectionKey, coverImageKey: firstImageKey });
      }
    }

    const ownerlessCursor = await transaction.query('FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.deletedAt == null LET ownerCount = LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == collection._key && member.role == "owner" RETURN 1) FILTER ownerCount == 0 RETURN { key: collection._key, name: collection.name }', { scopeKey });
    const ownerless = await ownerlessCursor.all() as Array<{ key: string; name: string }>;
    for (const collection of ownerless) {
      const owner = collectionMemberSchema.parse({ key: deterministicGalleryFixtureKey(scopeKey, 'legacy-owner', collection.key), scopeKey, collectionKey: collection.key, memberKey: oscarMembershipKey, role: 'owner', createdAt: NOW });
      await transaction.query('UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, memberKey: @memberKey } INSERT @document UPDATE { role: "owner" } IN collectionMembers', { scopeKey, collectionKey: collection.key, memberKey: oscarMembershipKey, document: document(owner) });
    }

    const ownedCursor = await transaction.query('FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.deletedAt == null FILTER LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == collection._key && member.memberKey == @memberKey && member.role == "owner" LIMIT 1 RETURN 1) == 1 SORT collection.name RETURN { key: collection._key, name: collection.name }', { scopeKey, memberKey: oscarMembershipKey });
    const owned = await ownedCursor.all() as Array<{ key: string; name: string }>;
    for (const collection of owned) {
      const fixture = buildOwnedCollectionFixturePlan(scopeKey, collection.key);
      const collaborator = collectionMemberSchema.parse({ key: fixture.collaboratorMemberKey, scopeKey, collectionKey: collection.key, memberKey: plan.identities[0]!.membershipKey, role: 'collaborator', createdAt: NOW });
      const viewer = collectionMemberSchema.parse({ key: fixture.viewerMemberKey, scopeKey, collectionKey: collection.key, memberKey: plan.identities[1]!.membershipKey, role: 'viewer', createdAt: NOW });
      await transaction.query('UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, memberKey: @memberKey } INSERT @document UPDATE {} IN collectionMembers', { scopeKey, collectionKey: collection.key, memberKey: collaborator.memberKey, document: document(collaborator) });
      await transaction.query('UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, memberKey: @memberKey } INSERT @document UPDATE {} IN collectionMembers', { scopeKey, collectionKey: collection.key, memberKey: viewer.memberKey, document: document(viewer) });

      const shares = [
        shareSchema.parse({ key: fixture.viewerShareKey, scopeKey, sourceType: 'collection', sourceKey: collection.key, permission: 'viewer', tokenHash: sha256(fixture.viewerToken), deletedAt: null, createdAt: NOW, updatedAt: NOW }),
        shareSchema.parse({ key: fixture.collaboratorShareKey, scopeKey, sourceType: 'collection', sourceKey: collection.key, permission: 'collaborator', tokenHash: sha256(fixture.collaboratorToken), revokedAt: REVOKED_AT, deletedAt: null, createdAt: NOW, updatedAt: REVOKED_AT }),
      ];
      for (const [index, share] of shares.entries()) {
        const token = index === 0 ? fixture.viewerToken : fixture.collaboratorToken;
        const response = { share: safeShare(share, token), token };
        await transaction.query('UPSERT { _key: @key } INSERT MERGE(@document, { requestHash: @requestHash, responseCiphertext: @responseCiphertext }) UPDATE {} IN shares', {
          key: share.key,
          document: document(share),
          requestHash: requestHash({ collectionKey: collection.key, role: share.permission, active: !share.revokedAt }),
          responseCiphertext: encryptAuthenticatedJson(response),
        });
      }
    }
    return { owned, placementPlan };
  });
  const ownedRows = seeded.owned;
  const placementKeys = seeded.placementPlan.flatMap(({ placements }) => placements.map(({ key }) => key));

  const verificationCursor = await db.query(`
    LET ownerless = LENGTH(FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.deletedAt == null FILTER LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == collection._key && member.role == "owner" RETURN 1) == 0 RETURN 1)
    LET badReferences = LENGTH(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member._key IN @fixtureMemberKeys LET collection = DOCUMENT(collections, member.collectionKey) LET membership = DOCUMENT(userOrganizations, member.memberKey) FILTER collection == null || collection.scopeKey != @scopeKey || collection.deletedAt != null || membership == null || membership.organizationId != @organizationKey || membership.status != "active" RETURN 1)
    LET badPlacements = LENGTH(FOR relation IN collectionImages FILTER relation._key IN @placementKeys LET image = DOCUMENT(images, relation.imageKey) LET collection = DOCUMENT(collections, relation.collectionKey) LET addedBy = DOCUMENT(userOrganizations, relation.addedByKey) FILTER relation.scopeKey != @scopeKey || image == null || image.scopeKey != @scopeKey || image.deletedAt != null || collection == null || collection.scopeKey != @scopeKey || collection.deletedAt != null || addedBy == null || addedBy.organizationId != @organizationKey || addedBy.status != "active" RETURN 1)
    LET shared = (FOR collectionKey IN @sharedCollectionKeys LET collection = DOCUMENT(collections, collectionKey) LET owners = (FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == collectionKey && member.role == "owner" RETURN member.memberKey) LET oscarRole = FIRST(FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey == collectionKey && member.memberKey == @oscarMembershipKey RETURN member.role) LET seededPlacementCount = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == collectionKey && relation._key IN @placementKeys RETURN 1) LET placementCount = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == collectionKey RETURN 1) LET coverValid = collection.coverImageKey != null && LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == collectionKey && relation.imageKey == collection.coverImageKey LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.scopeKey == @scopeKey && image.deletedAt == null LIMIT 1 RETURN 1) == 1 RETURN { key: collectionKey, name: collection.name, ownerCount: LENGTH(owners), oscarRole, oscarIsOwner: @oscarMembershipKey IN owners, seededPlacementCount, placementCount, coverImageKey: collection.coverImageKey, coverValid })
    LET shares = (FOR key IN @shareKeys LET share = DOCUMENT(shares, key) RETURN share)
    LET invites = (FOR key IN @inviteKeys LET invite = DOCUMENT(collectionInvites, key) RETURN invite)
    RETURN { ownerless, badReferences, badPlacements, shared, shares, invites }
  `, {
    scopeKey,
    organizationKey,
    oscarMembershipKey,
    sharedCollectionKeys: plan.collections.map(({ collectionKey }) => collectionKey),
    placementKeys,
    fixtureMemberKeys: [
      ...plan.collections.flatMap(({ ownerMemberKey, oscarMemberKey }) => [ownerMemberKey, oscarMemberKey]),
      ...ownedRows.flatMap(({ key }) => { const fixture = buildOwnedCollectionFixturePlan(scopeKey, key); return [fixture.collaboratorMemberKey, fixture.viewerMemberKey]; }),
    ],
    shareKeys: ownedRows.flatMap(({ key }) => { const fixture = buildOwnedCollectionFixturePlan(scopeKey, key); return [fixture.viewerShareKey, fixture.collaboratorShareKey]; }),
    inviteKeys: plan.collections.map(({ inviteKey }) => inviteKey),
  });
  const verification = await verificationCursor.next() as { ownerless: number; badReferences: number; badPlacements: number; shared: Array<{ key: string; name: string; ownerCount: number; oscarRole: string; oscarIsOwner: boolean; seededPlacementCount: number; placementCount: number; coverImageKey: string | null; coverValid: boolean }>; shares: unknown[]; invites: unknown[] };
  if (verification.ownerless !== 0 || verification.badReferences !== 0 || verification.badPlacements !== 0) throw new Error('Gallery sharing fixture referential integrity verification failed.');
  if (verification.shared.length !== plan.collections.length || verification.shared.some((row, index) => {
    const expectedPlacements = seeded.placementPlan[index]!.placements.length;
    return row.ownerCount !== 1 || row.oscarIsOwner || row.oscarRole !== plan.collections[index]!.oscarRole || row.seededPlacementCount !== expectedPlacements || row.placementCount < expectedPlacements || (expectedPlacements > 0 && (!row.coverImageKey || !row.coverValid));
  })) throw new Error('Shared collection ownership, role, placement, or cover verification failed.');
  if (verification.shares.length !== ownedRows.length * 2 || verification.invites.length !== plan.collections.length) throw new Error('Gallery sharing fixture counts are incorrect.');

  for (const raw of verification.shares) {
    const stored = raw as Record<string, unknown>;
    const share = shareSchema.parse(withArangoKey(stored));
    const ciphertext = String(stored.responseCiphertext);
    const replay = decryptAuthenticatedJson(ciphertext) as { token?: unknown };
    if (typeof replay.token !== 'string' || sha256(replay.token) !== share.tokenHash || ciphertext.includes(replay.token)) throw new Error(`Share ${share.key} token verification failed.`);
    if ((share.permission === 'viewer') !== !share.revokedAt) throw new Error(`Share ${share.key} active status verification failed.`);
  }
  for (const raw of verification.invites) {
    const stored = raw as Record<string, unknown>;
    const invite = collectionInviteSchema.parse(withArangoKey(stored));
    const ciphertext = String(stored.responseCiphertext);
    const replay = decryptAuthenticatedJson(ciphertext) as { token?: unknown };
    if (invite.inviteeKey !== oscarMembershipKey || invite.acceptedAt || invite.rejectedAt || invite.revokedAt || typeof replay.token !== 'string' || sha256(replay.token) !== invite.tokenHash || ciphertext.includes(replay.token)) throw new Error(`Invite ${invite.key} verification failed.`);
  }

  console.log(`Gallery collaboration fixtures verified for ${EMAIL} in scope ${scopeKey}.`);
  console.table([
    ...ownedRows.map((collection) => ({ collection: collection.name, tab: 'My', oscarRole: 'owner', collaborators: 1, viewers: 1, activeLinks: 1, inactiveLinks: 1 })),
    ...verification.shared.map((collection) => ({ collection: collection.name, tab: 'Shared', oscarRole: collection.oscarRole, images: collection.placementCount, collaborators: collection.oscarRole === 'collaborator' ? 1 : 0, viewers: collection.oscarRole === 'viewer' ? 1 : 0, activeLinks: 0, inactiveLinks: 0 })),
  ]);
}

try { await main(); }
finally { await closeDb(); }
