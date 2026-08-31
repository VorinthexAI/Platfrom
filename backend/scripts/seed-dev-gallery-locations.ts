import sharp from 'sharp';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { hashUserEmail } from '@/api/users';
import { processImage } from '@/lib/ai/image-processing';
import { closeDb, db } from '@/lib/db/client';
import { collectionImageSchema } from '@/lib/db/collection-images.node';
import { collectionMemberSchema } from '@/lib/db/collection-members.node';
import { collectionSchema } from '@/lib/db/collections.node';
import { getPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { getUserByEmailHash } from '@/lib/db/users.node';
import { currentEmbeddingSchema, embedTexts } from '@/lib/embeddings';
import { galleryOperations } from '@/lib/gallery/operations';
import { getDefaultGalleryRepository } from '@/lib/gallery/repository';
import { buildImageEmbeddingText } from '@/lib/image-embedding';
import { s3, S3_BUCKET } from '@/lib/s3';
import {
  assertGalleryLocationFixtureEnvironment, buildGalleryLocationFixturePlan, GALLERY_LOCATION_FIXTURE_EMAIL,
  galleryLocationFixtureSvg, parseGalleryLocationFixtureArgs,
} from './seed-dev-gallery-locations-fixtures';

const options = parseGalleryLocationFixtureArgs(process.argv.slice(2));
assertGalleryLocationFixtureEnvironment(process.env);
const fixtureCaption = (city: string, country: string) => `Synthetic Gallery QA image for ${city}, ${country}. Abstract city scene used only for local development testing.`;

async function main() {
  const user = await getUserByEmailHash(await hashUserEmail(GALLERY_LOCATION_FIXTURE_EMAIL));
  if (!user || user.email.trim().toLowerCase() !== GALLERY_LOCATION_FIXTURE_EMAIL) throw new Error(`Exact dev user ${GALLERY_LOCATION_FIXTURE_EMAIL} does not exist.`);
  const auth = await getPersonalAuthContext(user.key);
  if (!auth) throw new Error(`Personal Gallery context for ${GALLERY_LOCATION_FIXTURE_EMAIL} is unavailable.`);
  // Cleanup always considers the optional duplicate id so omitting the creation flag cannot strand it.
  const plan = buildGalleryLocationFixturePlan(auth.scope.key, options.runId, options.mode === 'cleanup' || options.includeDuplicates);
  const context = { organizationKey: auth.organization.key, scopeKey: auth.scope.key, membership: auth.membership };
  const repository = getDefaultGalleryRepository();
  const ids = [plan.collection.key, plan.collection.memberKey, ...plan.images.flatMap((image) => [image.key, image.captionKey, image.placementKey])];

  const manifest = {
    mode: options.mode,
    targetEmail: GALLERY_LOCATION_FIXTURE_EMAIL,
    scopeKey: auth.scope.key,
    runId: plan.runId,
    marker: plan.marker,
    collection: plan.collection,
    duplicatesEnabled: plan.images.some(({ duplicateOf }) => duplicateOf !== null),
    images: plan.images.map(({ colors: _colors, visualIndex: _visualIndex, captionKey, placementKey, ...image }) => ({ ...image, captionKey, placementKey })),
  };

  const fixtureRows = async () => (await db.query(`
    LET collection = DOCUMENT(collections, @collectionKey)
    LET member = DOCUMENT(collectionMembers, @memberKey)
    LET images = (FOR imageKey IN @imageKeys LET image = DOCUMENT(images, imageKey) LET caption = image == null ? null : DOCUMENT(imageCaptions, image.imageCaptionKey) LET placement = FIRST(FOR relation IN collectionImages FILTER relation._key IN @placementKeys && relation.imageKey == imageKey RETURN relation) RETURN { image, caption, placement })
    RETURN { collection, member, images }
  `, { collectionKey: plan.collection.key, memberKey: plan.collection.memberKey, imageKeys: plan.images.map(({ key }) => key), placementKeys: plan.images.map(({ placementKey }) => placementKey) })).next() as Promise<{ collection: Record<string, unknown> | null; member: Record<string, unknown> | null; images: Array<{ image: Record<string, unknown> | null; caption: Record<string, unknown> | null; placement: Record<string, unknown> | null }> }>;

  const verify = async () => {
    const rows = await fixtureRows();
    if (!rows.collection || rows.collection._key !== plan.collection.key || rows.collection.scopeKey !== auth.scope.key || rows.collection.description !== plan.collection.description) throw new Error('Fixture collection is missing or does not exactly match the manifest.');
    if (!rows.member || rows.member._key !== plan.collection.memberKey || rows.member.memberKey !== auth.membership.key || rows.member.role !== 'owner') throw new Error('Fixture collection owner membership is missing or invalid.');
    for (const [index, expected] of plan.images.entries()) {
      const row = rows.images[index]!;
      if (!row.image || row.image._key !== expected.key || row.image.scopeKey !== auth.scope.key || row.image.createdByKey !== auth.membership.key || row.image.imageCaptionKey !== expected.captionKey || row.image.filename !== expected.filename || row.image.city !== expected.city || row.image.country !== expected.country || row.image.countryCode !== expected.countryCode) throw new Error(`Fixture image ${expected.key} is missing or invalid.`);
      if (!row.caption || row.caption.score !== expected.captionScore || row.caption.scoreVersion !== 1) throw new Error(`Fixture caption score for ${expected.key} is missing or invalid.`);
      if (!row.placement || row.placement._key !== expected.placementKey || row.placement.collectionKey !== plan.collection.key || row.placement.addedByKey !== auth.membership.key) throw new Error(`Fixture placement for ${expected.key} is missing or invalid.`);
    }
    console.log(JSON.stringify({ ...manifest, verified: true }, null, 2));
  };

  if (options.mode === 'verify') return verify();

  if (options.mode === 'cleanup') {
    const rows = await fixtureRows();
    if (rows.collection && (rows.collection.scopeKey !== auth.scope.key || rows.collection.description !== plan.collection.description)) throw new Error('Cleanup refused: deterministic collection id is not the exact fixture collection.');
    const existingImageKeys = rows.images.flatMap(({ image }, index) => {
      if (!image) return [];
      const expected = plan.images[index]!;
      if (image.scopeKey !== auth.scope.key || image.createdByKey !== auth.membership.key || image.filename !== expected.filename) throw new Error(`Cleanup refused: image ${expected.key} does not exactly match the fixture.`);
      return [expected.key];
    });
    if (existingImageKeys.length) await galleryOperations.deleteImages({ imageKeys: existingImageKeys }, context);
    if (rows.collection) await galleryOperations.deleteCollection({ collectionKey: plan.collection.key }, context);
    console.log(JSON.stringify({ ...manifest, deletedImageKeys: existingImageKeys, deletedCollectionKey: rows.collection ? plan.collection.key : null }, null, 2));
    return;
  }

  const collisions = await (await db.query(`
    FOR collectionName IN ['collections', 'collectionMembers', 'collectionImages', 'images', 'imageCaptions']
      FOR id IN @ids
        LET document = DOCUMENT(collectionName, id)
        FILTER document != null
        RETURN { collectionName, id }
  `, { ids })).all() as Array<{ collectionName: string; id: string }>;
  const bytes = await Promise.all(plan.images.map((image) => sharp(Buffer.from(galleryLocationFixtureSvg(image.visualIndex, image.colors))).png().toBuffer()));
  const storageKeys = plan.images.map((image, index) => `media/${auth.scope.key}/${image.key}/${new Bun.CryptoHasher('sha256').update(bytes[index]!).digest('hex')}/original.png`);
  const existingObjects = (await Promise.all(storageKeys.map(async (key) => {
    try { await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key })); return key; }
    catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404 || (error as { name?: string }).name === 'NotFound') return null; throw error; }
  }))).filter((key): key is string => Boolean(key));
  if (collisions.length || existingObjects.length) throw new Error(`Insert-only preflight found collisions: ${JSON.stringify({ documents: collisions, storageKeys: existingObjects })}`);
  console.log(JSON.stringify({ ...manifest, storageKeys, preflight: 'clear' }, null, 2));
  if (options.mode === 'dry-run') return;

  const collectionEmbeddingText = `${plan.collection.name}\n\n${plan.collection.description}`;
  const imageEmbeddingTexts = plan.images.flatMap((fixture) => {
    const caption = fixtureCaption(fixture.city, fixture.country);
    return [
      buildImageEmbeddingText({ filename: fixture.filename, caption }),
      buildImageEmbeddingText({ filename: fixture.filename, caption, city: fixture.city, country: fixture.country, countryCode: fixture.countryCode }),
    ];
  });
  const fixtureEmbeddings = await embedTexts({ texts: [collectionEmbeddingText, ...imageEmbeddingTexts] });
  const collectionEmbedding = currentEmbeddingSchema.parse(fixtureEmbeddings[0]);
  const imageEmbeddingByText = new Map(imageEmbeddingTexts.map((text, index) => [text, currentEmbeddingSchema.parse(fixtureEmbeddings[index + 1])]));
  const createdImageKeys: string[] = [];
  let collectionCreated = false;
  try {
    const now = new Date().toISOString();
    const collection = collectionSchema.parse({ key: plan.collection.key, scopeKey: auth.scope.key, name: plan.collection.name, description: plan.collection.description, embedding: collectionEmbedding, isFavorite: false, createdAt: now, updatedAt: now });
    const member = collectionMemberSchema.parse({ key: plan.collection.memberKey, scopeKey: auth.scope.key, collectionKey: collection.key, memberKey: auth.membership.key, role: 'owner', createdAt: now });
    if (!await repository.createCollection(collection, member)) throw new Error('Canonical Gallery collection creation was denied.');
    collectionCreated = true;

    for (const [index, fixture] of plan.images.entries()) {
      const image = await processImage({
        scopeKey: auth.scope.key,
        ownerKey: auth.membership.key,
        origin: 'generated',
        imageKey: fixture.key,
        file: { filename: fixture.filename, mimeType: 'image/png', sizeBytes: bytes[index]!.byteLength, bytes: bytes[index]! },
        location: { city: fixture.city, country: fixture.country, countryCode: fixture.countryCode },
      }, {
        createCaptionKey: () => fixture.captionKey,
        caption: async () => ({ caption: fixtureCaption(fixture.city, fixture.country), score: fixture.captionScore }),
        embed: async (text) => {
          const embedding = imageEmbeddingByText.get(text);
          if (!embedding) throw new Error(`No deterministic fixture embedding was prepared for ${fixture.key}.`);
          return embedding;
        },
      });
      createdImageKeys.push(image.key);
      const relation = collectionImageSchema.parse({ key: fixture.placementKey, scopeKey: auth.scope.key, collectionKey: collection.key, imageKey: image.key, addedByKey: auth.membership.key, createdAt: new Date().toISOString() });
      await repository.addImageToCollection(relation);
    }
    await verify();
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    if (createdImageKeys.length) await galleryOperations.deleteImages({ imageKeys: createdImageKeys }, context).catch((failure) => cleanupErrors.push(failure));
    if (collectionCreated) await galleryOperations.deleteCollection({ collectionKey: plan.collection.key }, context).catch((failure) => cleanupErrors.push(failure));
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], 'Gallery location fixture creation and compensation failed.');
    throw error;
  }
}

let failed = false;
try { await main(); }
catch (error) { failed = true; console.error(error); }
finally { await closeDb(); }
process.exit(failed ? 1 : 0);
