import { hashUserEmail } from '@/api/users';
import { toArangoDoc } from '@/lib/db/base';
import { closeDb, db } from '@/lib/db/client';
import { collectionImageSchema } from '@/lib/db/collection-images.node';
import { getPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { getUserByEmailHash } from '@/lib/db/users.node';
import { galleryOperations } from '@/lib/gallery/operations';
import { newId } from '@/lib/ids';

const EMAIL = process.env.DEV_SEED_EMAIL?.trim().toLowerCase() || 'oscar.burman005@gmail.com';
const FIXTURE_MARKER = 'Development Gallery fixture:';

async function main() {
  const user = await getUserByEmailHash(await hashUserEmail(EMAIL));
  if (!user) throw new Error(`Dev user ${EMAIL} does not exist.`);
  const auth = await getPersonalAuthContext(user.key);
  if (!auth) throw new Error(`Personal Gallery context for ${EMAIL} is unavailable.`);

  const cursor = await db.query(`
    FOR collection IN collections
      FILTER collection.scopeKey == @scopeKey
        && collection.name == 'Studio Objects'
        && STARTS_WITH(collection.description, @marker)
      LET imageKeys = (
        FOR relation IN collectionImages
          FILTER relation.scopeKey == @scopeKey && relation.collectionKey == collection._key
          FOR image IN images
            FILTER image._key == relation.imageKey && image.deletedAt == null
            SORT image.filename
            RETURN image._key
      )
      LET actionImages = (
        FOR imageKey IN imageKeys
          LET image = DOCUMENT(images, imageKey)
          FILTER imageKey != collection.coverImageKey
            && LENGTH(FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.imageKey == imageKey LIMIT 1 RETURN 1) == 0
          SORT image.filename DESC
          LIMIT 2
          RETURN { key: imageKey, isFavorite: image.isFavorite }
      )
      LET destinationCollectionKeys = (
        FOR destination IN collections
          FILTER destination.scopeKey == @scopeKey
            && destination.name IN ['Nordic Light', 'City After Rain']
            && STARTS_WITH(destination.description, @marker)
          SORT destination.name
          RETURN destination._key
      )
      LIMIT 1
      RETURN { collectionKey: collection._key, destinationCollectionKeys, imageKeys, actionImages }
  `, { scopeKey: auth.scope.key, marker: FIXTURE_MARKER });
  const fixture = await cursor.next() as { collectionKey: string; destinationCollectionKeys: string[]; imageKeys: string[]; actionImages: Array<{ key: string; isFavorite: boolean }> } | undefined;
  if (!fixture || fixture.imageKeys.length < 2 || fixture.destinationCollectionKeys.length !== 2 || fixture.actionImages.length !== 2) throw new Error('Seeded Gallery fixtures are unavailable. Run seed:dev-media first.');

  const context = { organizationKey: auth.organization.key, scopeKey: auth.scope.key, membership: auth.membership };
  const query = `gallery live e2e ${Date.now()}`;
  await galleryOperations.search({ query, limit: 5 }, context);
  const normalizedQuery = query.toLowerCase();
  const history = await (await db.query('FOR search IN userSearches FILTER search.userKey == @userKey && search.normalizedQuery == @normalizedQuery RETURN search', { userKey: auth.membership.userId, normalizedQuery })).all();
  if (history.length !== 1 || history[0]?.usageCount !== 1) throw new Error('Gallery text search did not record global user history exactly once.');
  let similar: Awaited<ReturnType<typeof galleryOperations.search>>;
  let duplicates: Awaited<ReturnType<typeof galleryOperations.search>>;
  try {
    similar = await galleryOperations.search({ imageKey: fixture.imageKeys[0], collectionKey: fixture.collectionKey, threshold: 0.8, limit: 20 }, context);
    if (similar.images.length !== fixture.imageKeys.length - 1 || similar.images.some((image) => image.key === fixture.imageKeys[0] || image.score === undefined || image.score < 0.8)) {
      throw new Error('Source-image similarity did not return the expected scoped, score-bearing results.');
    }

    duplicates = await galleryOperations.search({ duplicates: true, collectionKey: fixture.collectionKey }, context);
    if (duplicates.images.length !== 1 || duplicates.images[0]?.score !== undefined || !fixture.imageKeys.slice(0, 2).includes(duplicates.images[0]!.key)) {
      throw new Error('Duplicate discovery did not return the deterministic seeded duplicate.');
    }
    const usageAfterNonTextSearches = await (await db.query('RETURN DOCUMENT(userSearches, @key).usageCount', { key: history[0]!._key })).next();
    if (usageAfterNonTextSearches !== 1) throw new Error('Similarity or duplicate search changed global text-search history.');
  } finally {
    await db.query('REMOVE @key IN userSearches OPTIONS { ignoreErrors: true }', { key: history[0]!._key });
  }

  const actionImageKeys = fixture.actionImages.map(({ key }) => key);
  const sourceRelations = actionImageKeys.map((imageKey) => collectionImageSchema.parse({ key: newId(), scopeKey: auth.scope.key, collectionKey: fixture.collectionKey, imageKey, addedByKey: auth.membership.key, createdAt: new Date().toISOString() }));
  const restoreFixture = async () => {
    await db.query('FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey IN @destinationCollectionKeys && relation.imageKey IN @imageKeys REMOVE relation IN collectionImages', { scopeKey: auth.scope.key, destinationCollectionKeys: fixture.destinationCollectionKeys, imageKeys: actionImageKeys });
    for (const [index, relation] of sourceRelations.entries()) {
      await db.query('UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey: @imageKey } INSERT @relation UPDATE {} IN collectionImages', { scopeKey: auth.scope.key, collectionKey: fixture.collectionKey, imageKey: relation.imageKey, relation: toArangoDoc(relation) });
      await db.query('FOR image IN images FILTER image._key == @imageKey && image.scopeKey == @scopeKey UPDATE image WITH { deletedAt: null, isFavorite: @isFavorite } IN images', { scopeKey: auth.scope.key, imageKey: relation.imageKey, isFavorite: fixture.actionImages[index]!.isFavorite });
    }
  };

  await restoreFixture();
  try {
    const favorite = await galleryOperations.setFavorite({ imageKey: actionImageKeys[0], isFavorite: !fixture.actionImages[0]!.isFavorite }, context);
    if (favorite.image.isFavorite === fixture.actionImages[0]!.isFavorite) throw new Error('Favorite mutation did not update the image.');
    await galleryOperations.setFavorite({ imageKey: actionImageKeys[0], isFavorite: fixture.actionImages[0]!.isFavorite }, context);

    const copied = await galleryOperations.transferCollectionImages({ sourceCollectionKey: fixture.collectionKey, destinationCollectionKeys: fixture.destinationCollectionKeys, imageKeys: actionImageKeys, mode: 'copy' }, context);
    if (copied.createdRelationCount !== 4) throw new Error('Many-to-many collection copy did not create the expected placements.');
    const moved = await galleryOperations.transferCollectionImages({ sourceCollectionKey: fixture.collectionKey, destinationCollectionKeys: fixture.destinationCollectionKeys, imageKeys: actionImageKeys, mode: 'move' }, context);
    if (moved.createdRelationCount !== 0) throw new Error('Collection move duplicated an existing destination placement.');

    const deleted = await galleryOperations.deleteImages({ imageKeys: actionImageKeys }, context);
    if (deleted.deletedImageKeys.length !== actionImageKeys.length) throw new Error('Image deletion did not return every deleted image.');
    const deletedCursor = await db.query('FOR image IN images FILTER image._key IN @imageKeys && image.scopeKey == @scopeKey RETURN image.deletedAt != null', { scopeKey: auth.scope.key, imageKeys: actionImageKeys });
    if ((await deletedCursor.all()).some((deletedAt) => deletedAt !== true)) throw new Error('Image deletion was not persisted.');
  } finally {
    await restoreFixture();
  }

  console.log(`Gallery live E2E passed: ${similar.images.length} similar, ${duplicates.images.length} duplicate, favorite, 2x2 copy/move, and batch delete.`);
}

try {
  await main();
} finally {
  await closeDb();
}
