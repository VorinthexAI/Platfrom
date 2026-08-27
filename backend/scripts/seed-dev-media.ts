import sharp from 'sharp';
import { hashUserEmail } from '@/api/users';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { toArangoDoc } from '@/lib/db/base';
import { closeDb, db, withTransaction } from '@/lib/db/client';
import { collectionImageSchema, type CollectionImage } from '@/lib/db/collection-images.node';
import { collectionMemberSchema, type CollectionMember } from '@/lib/db/collection-members.node';
import { collectionSchema, type Collection } from '@/lib/db/collections.node';
import { imageCaptionRecordSchema, PERCEPTUAL_HASH_ALGORITHM, type ImageCaptionRecord } from '@/lib/db/image-captions.node';
import { imageSchema, type Image } from '@/lib/db/images.node';
import { getPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { getUserByEmailHash } from '@/lib/db/users.node';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { computePerceptualHash, perceptualHashSegments } from '@/lib/perceptual-hash';
import { S3_BUCKET } from '@/lib/s3';
import { galleryDevelopmentFixtureKey } from '@/lib/development-fixture-assets';

const EMAIL = process.env.DEV_SEED_EMAIL?.trim().toLowerCase() || 'oscar.burman005@gmail.com';
const FIXTURE_MARKER = 'Development Gallery fixture:';
const NOW = '2026-08-14T12:00:00.000Z';

const collections = [
  { slug: 'nordic-light', name: 'Nordic Light', description: 'Soft interiors, pale skies, and quiet morning studies.', count: 12, colors: ['#d9e5e8', '#8ca9b3', '#f2c9a5'] },
  { slug: 'city-after-rain', name: 'City After Rain', description: 'Wet streets, reflected signs, and late urban walks.', count: 10, colors: ['#16243a', '#3f6f8c', '#d98d62'] },
  { slug: 'studio-objects', name: 'Studio Objects', description: 'Material studies, tools, ceramics, and working surfaces.', count: 9, colors: ['#d8c4a6', '#8d5e4a', '#31403c'] },
  { slug: 'coastal-days', name: 'Coastal Days', description: 'Open water, weathered paths, and summer horizon lines.', count: 8, colors: ['#75b6c9', '#d7c99c', '#f3eee0'] },
  { slug: 'quiet-architecture', name: 'Quiet Architecture', description: 'Concrete geometry, shadow, glass, and restrained spaces.', count: 8, colors: ['#c9c8c3', '#686d73', '#252a31'] },
  { slug: 'night-signals', name: 'Night Signals', description: 'Low light, distant glow, and electric color after dark.', count: 7, colors: ['#120f2f', '#6b3fa0', '#ef6f91'] },
  { slug: 'field-notes', name: 'Field Notes', description: 'Leaves, trails, changing weather, and small outdoor details.', count: 6, colors: ['#536b4d', '#b9a66b', '#d7d2b4'] },
] as const;

function requireLocalEndpoint(name: string, value: string | undefined) {
  let hostname = '';
  try {
    hostname = value ? new URL(value).hostname : '';
  } catch {
    throw new Error(`${name} must be a valid local development URL.`);
  }
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && !hostname.startsWith('192.168.')) {
    throw new Error(`${name} must point to a local development service.`);
  }
}

function embedding(collectionIndex: number, imageIndex?: number) {
  const vector = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[collectionIndex] = 1;
  if (imageIndex !== undefined) vector[collections.length + imageIndex] = 0.05;
  return vector;
}

function fixtureSvg(index: number, colors: readonly [string, string, string]) {
  const x = 80 + index * 47 % 470;
  const y = 90 + index * 71 % 430;
  const radius = 90 + index * 17 % 150;
  const tilt = index * 19 % 180;
  const horizon = 250 + index * 29 % 260;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720">
    <defs>
      <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${colors[0]}"/>
        <stop offset="0.56" stop-color="${colors[1]}"/>
        <stop offset="1" stop-color="${colors[2]}"/>
      </linearGradient>
      <filter id="grain"><feTurbulence baseFrequency="0.72" numOctaves="3" seed="${index + 1}" type="fractalNoise"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .12 0"/></filter>
    </defs>
    <rect width="720" height="720" fill="url(#background)"/>
    <circle cx="${x}" cy="${y}" r="${radius}" fill="#ffffff" fill-opacity="0.18"/>
    <rect x="-80" y="${horizon}" width="900" height="210" rx="34" fill="#0b1016" fill-opacity="0.22" transform="rotate(${tilt} 360 360)"/>
    <path d="M0 ${590 - index % 7 * 18} C180 ${470 + index % 5 * 25}, 430 ${680 - index % 4 * 30}, 720 ${430 + index % 6 * 24} L720 720 L0 720 Z" fill="#ffffff" fill-opacity="0.16"/>
    <path d="M${x - 110} ${y + 170} L${x + 210} ${y - 120} L${x + 280} ${y + 230} Z" fill="#10151c" fill-opacity="0.18"/>
    <rect width="720" height="720" filter="url(#grain)" opacity="0.5"/>
  </svg>`;
}

async function main() {
  requireLocalEndpoint('ARANGO_URL', process.env.ARANGO_URL);
  requireLocalEndpoint('S3 endpoint', process.env.S3_ENDPOINT_URL ?? process.env.AWS_ENDPOINT_URL);
  if (S3_BUCKET !== 'vorinthex-dev') throw new Error('Gallery fixtures may only use the vorinthex-dev bucket.');

  const user = await getUserByEmailHash(await hashUserEmail(EMAIL));
  if (!user) throw new Error(`Dev user ${EMAIL} does not exist. Sign in once before seeding.`);
  const context = await getPersonalAuthContext(user.key);
  if (!context) throw new Error(`Personal Gallery context for ${EMAIL} is unavailable.`);

  const scopeKey = context.scope.key;
  const actorKey = context.membership.key;
  const collectionDocuments: Collection[] = [];
  const imageDocuments: Image[] = [];
  const captionDocuments: ImageCaptionRecord[] = [];
  const collectionMemberships: CollectionMember[] = [];
  const imageRelations: CollectionImage[] = [];
  let imageIndex = 0;

  for (const [collectionIndex, fixtureCollection] of collections.entries()) {
    const collectionKey = galleryDevelopmentFixtureKey(scopeKey, 'collection', fixtureCollection.slug);
    const collectionImages = [];
    const collectionEmbedding = embedding(collectionIndex);

    for (let localIndex = 0; localIndex < fixtureCollection.count; localIndex += 1) {
      imageIndex += 1;
      const logicalName = `${fixtureCollection.slug}-${String(localIndex + 1).padStart(2, '0')}`;
      const filename = `${logicalName}.png`;
      const storageKey = `gallery/dev-seed/${scopeKey}/${logicalName}.png`;
      const imageKey = galleryDevelopmentFixtureKey(scopeKey, 'image', logicalName);
      const captionKey = galleryDevelopmentFixtureKey(scopeKey, 'caption', logicalName);
      const caption = `${fixtureCollection.name} study ${localIndex + 1}: ${fixtureCollection.description.toLowerCase()}`;
      const visualIndex = fixtureCollection.slug === 'studio-objects' && localIndex === 1 ? imageIndex - 1 : imageIndex;
      const bytes = await sharp(Buffer.from(fixtureSvg(visualIndex, fixtureCollection.colors))).png().toBuffer();
      const perceptualHash = await computePerceptualHash(bytes);
      const hashSegments = perceptualHashSegments(perceptualHash);
      const imageEmbedding = embedding(collectionIndex, localIndex);
      await documentStorage.upload({ key: storageKey, bytes, mimeType: 'image/png' });

      captionDocuments.push(imageCaptionRecordSchema.parse({
        key: captionKey,
        scopeKey,
        sourceImageKey: imageKey,
        caption,
        score: 80,
        scoreVersion: 1,
        embedding: imageEmbedding,
        perceptualHash,
        hashAlgorithm: PERCEPTUAL_HASH_ALGORITHM,
        hashSegment0: hashSegments[0],
        hashSegment1: hashSegments[1],
        hashSegment2: hashSegments[2],
        hashSegment3: hashSegments[3],
        createdAt: NOW,
        updatedAt: NOW,
      }));
      imageDocuments.push(imageSchema.parse({
        key: imageKey,
        scopeKey,
        filename,
        caption,
        storageKey,
        mimeType: 'image/png',
        sizeBytes: bytes.byteLength,
        width: 720,
        height: 720,
        embedding: imageEmbedding,
        imageCaptionKey: captionKey,
        isFavorite: imageIndex % 11 === 0,
        createdAt: NOW,
        updatedAt: NOW,
      }));
      collectionImages.push(imageKey);
      imageRelations.push(collectionImageSchema.parse({ key: galleryDevelopmentFixtureKey(scopeKey, 'placement', `${fixtureCollection.slug}:${logicalName}`), scopeKey, collectionKey, imageKey, addedByKey: actorKey, createdAt: NOW }));
    }

    collectionDocuments.push(collectionSchema.parse({
      key: collectionKey,
      scopeKey,
      name: fixtureCollection.name,
      description: `${FIXTURE_MARKER} ${fixtureCollection.description}`,
      coverImageKey: collectionImages[0],
      embedding: collectionEmbedding,
      isFavorite: fixtureCollection.slug === 'nordic-light',
      createdAt: NOW,
      updatedAt: NOW,
    }));
    collectionMemberships.push(collectionMemberSchema.parse({ key: galleryDevelopmentFixtureKey(scopeKey, 'membership', fixtureCollection.slug), scopeKey, collectionKey, memberKey: actorKey, role: 'owner', createdAt: NOW }));
  }

  await withTransaction({ write: ['collections', 'collectionMembers', 'images', 'imageCaptions', 'collectionImages'] }, async (transaction) => {
    for (const caption of captionDocuments) await transaction.query('UPSERT { _key: @key } INSERT @document REPLACE @document IN imageCaptions', { key: caption.key, document: toArangoDoc(caption) });
    for (const image of imageDocuments) await transaction.query('UPSERT { _key: @key } INSERT @document REPLACE @document IN images', { key: image.key, document: toArangoDoc(image) });
    for (const collection of collectionDocuments) await transaction.query('UPSERT { _key: @key } INSERT @document REPLACE @document IN collections', { key: collection.key, document: toArangoDoc(collection) });
    for (const membership of collectionMemberships) await transaction.query('UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, memberKey: @memberKey } INSERT @document UPDATE {} IN collectionMembers', { scopeKey: membership.scopeKey, collectionKey: membership.collectionKey, memberKey: membership.memberKey, document: toArangoDoc(membership) });
    for (const relation of imageRelations) await transaction.query('UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey: @imageKey } INSERT @document UPDATE {} IN collectionImages', { scopeKey: relation.scopeKey, collectionKey: relation.collectionKey, imageKey: relation.imageKey, document: toArangoDoc(relation) });
  });

  const verification = await db.query('FOR expected IN @collections LET collection = DOCUMENT(collections, expected.key) FILTER collection != null LET imageCount = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == expected.key RETURN 1) SORT collection.name RETURN { collection: collection.name, imageCount }', { scopeKey, collections: collectionDocuments.map(({ key }) => ({ key })) });
  const seeded = await verification.all() as Array<{ collection: string; imageCount: number }>;
  const expectedImages = collections.reduce((total, collection) => total + collection.count, 0);
  const missingPlacementCursor = await db.query('FOR expected IN @placements FILTER LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == expected.scopeKey && relation.collectionKey == expected.collectionKey && relation.imageKey == expected.imageKey LIMIT 1 RETURN 1) == 0 RETURN 1', { placements: imageRelations.map(({ scopeKey: relationScopeKey, collectionKey, imageKey }) => ({ scopeKey: relationScopeKey, collectionKey, imageKey })) });
  const missingPlacements = await missingPlacementCursor.all();
  if (seeded.length !== collections.length || missingPlacements.length !== 0) {
    throw new Error('Gallery fixture verification failed.');
  }
  console.log(`Verified ${seeded.length} Gallery collections and ${expectedImages} fixture image placements for ${EMAIL} in scope ${scopeKey}.`);
  console.table(seeded);
}

try {
  await main();
} finally {
  await closeDb();
}
