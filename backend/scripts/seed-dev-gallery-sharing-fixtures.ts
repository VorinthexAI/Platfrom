import { createHash } from 'node:crypto';
import { z } from 'zod';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';

export const DEV_GALLERY_SHARING_NOW = '2026-08-18T12:00:00.000Z';

const identitySchema = z.object({ slug: z.string().regex(/^[a-z-]+$/), name: z.string().min(1), email: z.string().email() }).strict();
const collectionFixtureSchema = z.object({ slug: z.string().regex(/^[a-z-]+$/), name: z.string().min(1), description: z.string().min(1), ownerSlug: z.string(), oscarRole: z.enum(['collaborator', 'viewer']) }).strict();
const placementCandidateSchema = z.object({ imageKey: z.string().cuid(), sourceCollectionKey: z.string().cuid().nullable() }).strict();
const placementTargetSchema = z.object({ collectionKey: z.string().cuid(), ownerMembershipKey: z.string().cuid() }).strict();

export const FAKE_IDENTITIES = z.array(identitySchema).parse([
  { slug: 'avery-stone', name: 'Avery Stone', email: 'avery.stone.gallery@example.test' },
  { slug: 'jules-park', name: 'Jules Park', email: 'jules.park.gallery@example.test' },
  { slug: 'morgan-reed', name: 'Morgan Reed', email: 'morgan.reed.gallery@example.test' },
]);

export const SHARED_COLLECTION_FIXTURES = z.array(collectionFixtureSchema).min(2).parse([
  { slug: 'field-references', name: 'Field References', description: 'A shared edit set of landscapes, textures, and location references.', ownerSlug: 'avery-stone', oscarRole: 'collaborator' },
  { slug: 'exhibition-selects', name: 'Exhibition Selects', description: 'A read-only review set for a small gallery wall study.', ownerSlug: 'jules-park', oscarRole: 'viewer' },
]);

export function deterministicGalleryFixtureKey(scopeKey: string, kind: string, logicalName: string) {
  return `c${createHash('sha256').update(`gallery-sharing\0${scopeKey}\0${kind}\0${logicalName}`).digest('hex').slice(0, 24)}`;
}

export function deterministicGalleryToken(scopeKey: string, kind: string, logicalName: string) {
  return createHash('sha256').update(`gallery-sharing-token\0${scopeKey}\0${kind}\0${logicalName}`).digest('base64url');
}

export function deterministicGalleryEmbedding(index: number) {
  const embedding = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  embedding[index % EMBEDDING_DIMENSIONS] = 1;
  embedding[(index * 31 + 17) % EMBEDDING_DIMENSIONS] += 0.125;
  return embedding;
}

export function assertDevLocalArango(environment: { ARANGO_URL?: string; NODE_ENV?: string }) {
  if (environment.NODE_ENV === 'production') throw new Error('Gallery collaboration fixtures cannot run in production.');
  let url: URL;
  try { url = new URL(environment.ARANGO_URL ?? ''); }
  catch { throw new Error('ARANGO_URL must be a valid local ArangoDB URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('ARANGO_URL must point to local ArangoDB on localhost or loopback.');
  }
}

export function buildGallerySharingFixturePlan(scopeKey: string) {
  const identities = FAKE_IDENTITIES.map((identity) => ({
    ...identity,
    userKey: deterministicGalleryFixtureKey(scopeKey, 'user', identity.slug),
    membershipKey: deterministicGalleryFixtureKey(scopeKey, 'user-organization', identity.slug),
  }));
  const identityBySlug = new Map(identities.map((identity) => [identity.slug, identity]));
  const collections = SHARED_COLLECTION_FIXTURES.map((fixture, index) => ({
    ...fixture,
    index,
    collectionKey: deterministicGalleryFixtureKey(scopeKey, 'collection', fixture.slug),
    ownerMembershipKey: identityBySlug.get(fixture.ownerSlug)!.membershipKey,
    ownerMemberKey: deterministicGalleryFixtureKey(scopeKey, 'collection-member', `${fixture.slug}:owner`),
    oscarMemberKey: deterministicGalleryFixtureKey(scopeKey, 'collection-member', `${fixture.slug}:oscar`),
    inviteKey: deterministicGalleryFixtureKey(scopeKey, 'collection-invite', `${fixture.slug}:oscar`),
  }));
  return { identities, collections };
}

export function buildOwnedCollectionFixturePlan(scopeKey: string, collectionKey: string) {
  return {
    collaboratorMemberKey: deterministicGalleryFixtureKey(scopeKey, 'collection-member', `${collectionKey}:collaborator`),
    viewerMemberKey: deterministicGalleryFixtureKey(scopeKey, 'collection-member', `${collectionKey}:viewer`),
    viewerShareKey: deterministicGalleryFixtureKey(scopeKey, 'collection-share', `${collectionKey}:viewer-active`),
    collaboratorShareKey: deterministicGalleryFixtureKey(scopeKey, 'collection-share', `${collectionKey}:collaborator-inactive`),
    viewerToken: deterministicGalleryToken(scopeKey, 'collection-share', `${collectionKey}:viewer-active`),
    collaboratorToken: deterministicGalleryToken(scopeKey, 'collection-share', `${collectionKey}:collaborator-inactive`),
  };
}

export function buildSharedCollectionPlacementPlan(
  scopeKey: string,
  rawTargets: Array<{ collectionKey: string; ownerMembershipKey: string }>,
  rawCandidates: Array<{ imageKey: string; sourceCollectionKey: string | null }>,
  imagesPerCollection = 4,
) {
  const targets = rawTargets.map((target) => placementTargetSchema.parse(target));
  const uniqueCandidates = [...new Map(rawCandidates.map((candidate) => {
    const parsed = placementCandidateSchema.parse(candidate);
    return [parsed.imageKey, parsed] as const;
  })).values()];
  const sourceQueues = new Map<string, typeof uniqueCandidates>();
  for (const candidate of uniqueCandidates) {
    const sourceKey = candidate.sourceCollectionKey ?? '';
    sourceQueues.set(sourceKey, [...(sourceQueues.get(sourceKey) ?? []), candidate]);
  }
  const sourceKeys = [...sourceQueues.keys()].sort((left, right) => left === '' ? 1 : right === '' ? -1 : left.localeCompare(right));
  for (const queue of sourceQueues.values()) queue.sort((left, right) => left.imageKey.localeCompare(right.imageKey));
  const distributedCandidates: typeof uniqueCandidates = [];
  while (distributedCandidates.length < uniqueCandidates.length) {
    for (const sourceKey of sourceKeys) {
      const candidate = sourceQueues.get(sourceKey)?.shift();
      if (candidate) distributedCandidates.push(candidate);
    }
  }
  const placements = targets.map((target) => ({ ...target, placements: [] as Array<{ key: string; imageKey: string; sourceCollectionKey: string | null }> }));
  for (const [index, candidate] of distributedCandidates.slice(0, targets.length * imagesPerCollection).entries()) {
    const round = Math.floor(index / targets.length);
    const target = placements[(index % targets.length + round) % targets.length]!;
    target.placements.push({
      key: deterministicGalleryFixtureKey(scopeKey, 'collection-image', `${target.collectionKey}:${candidate.imageKey}`),
      imageKey: candidate.imageKey,
      sourceCollectionKey: candidate.sourceCollectionKey,
    });
  }
  return placements;
}
