import { performance } from 'node:perf_hooks';
import { hashUserEmail } from '@/api/users';
import { imageCaptionTool } from '@/lib/ai/tools/image-caption';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { db } from '@/lib/db/client';
import { getPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { getUserByEmailHash } from '@/lib/db/users.node';
import { currentEmbeddingSchema, embedText } from '@/lib/embeddings';
import { computePerceptualHashBatch, perceptualHashSegments } from '@/lib/perceptual-hash';
import { signedImageUrl } from '@/lib/gallery/image-url';

const BATCH_SIZE = 20;
const execute = process.argv.includes('--execute');
const allScopes = process.argv.includes('--all');
const email = process.argv.find((argument) => argument.startsWith('--email='))?.slice('--email='.length).trim().toLowerCase();
if (Boolean(email) === allScopes) throw new Error('Choose exactly one target: --email=<exact-email> or --all. Add --execute only after reviewing dry-run counts.');

let scopeKey: string | undefined;
if (email) {
  const user = await getUserByEmailHash(await hashUserEmail(email));
  if (!user) throw new Error(`No user exists for ${email}.`);
  const context = await getPersonalAuthContext(user.key);
  if (!context) throw new Error(`No personal Gallery scope exists for ${email}.`);
  scopeKey = context.scope.key;
}

const staleFilter = 'FILTER caption.scoreVersion != 1 || !IS_NUMBER(caption.score) || caption.score < 1 || caption.score > 100 || caption.perceptualHash == null';
async function staleCount() {
  const cursor = await db.query<number>(`RETURN LENGTH(FOR caption IN imageCaptions FILTER @scopeKey == null || caption.scopeKey == @scopeKey ${staleFilter} RETURN 1)`, { scopeKey: scopeKey ?? null });
  return await cursor.next() ?? 0;
}

const initial = await staleCount();
console.log(`Gallery caption backfill target=${email ?? 'all scopes'} stale=${initial} mode=${execute ? 'execute' : 'dry-run'}`);
if (!execute || initial === 0) process.exit(0);

let updated = 0;
let after = '';
while (true) {
  const cursor = await db.query<{ key: string; revision: string; scopeKey: string; organizationKey: string; filename: string; storageKey: string }>(`
    FOR caption IN imageCaptions
      FILTER caption._key > @after
      FILTER @scopeKey == null || caption.scopeKey == @scopeKey
      ${staleFilter}
      LET image = FIRST(
        FOR candidate IN images
          FILTER candidate.imageCaptionKey == caption._key && candidate.scopeKey == caption.scopeKey
          SORT candidate.deletedAt == null DESC, candidate.createdAt ASC
          LIMIT 1
          RETURN candidate
      )
      FILTER image != null
      LET scope = DOCUMENT(scopes, caption.scopeKey)
      FILTER scope != null
      SORT caption._key ASC
      LIMIT @limit
      RETURN { key: caption._key, revision: caption._rev, scopeKey: caption.scopeKey, organizationKey: scope.organizationKey, filename: image.filename, storageKey: image.storageKey }
  `, { after, limit: BATCH_SIZE, scopeKey: scopeKey ?? null });
  const rows = await cursor.all();
  if (rows.length === 0) break;
  const startedAt = performance.now();
  const objects = await Promise.all(rows.map((row) => documentStorage.download(row.storageKey)));
  const hashStartedAt = performance.now();
  const hashes = await computePerceptualHashBatch(objects.map(({ bytes }) => bytes));
  const hashDurationMs = performance.now() - hashStartedAt;
  const urls = await Promise.all(rows.map(({ storageKey }) => signedImageUrl(storageKey)));
  const captionStartedAt = performance.now();
  const generated: Array<{ caption: string; score: number }> = Array(rows.length);
  const organizations = new Map<string, number[]>();
  rows.forEach((row, index) => organizations.set(row.organizationKey, [...organizations.get(row.organizationKey) ?? [], index]));
  await Promise.all([...organizations].map(async ([organizationKey, indices]) => {
    const results = (await imageCaptionTool.execute({ imageUrls: indices.map((index) => urls[index]!) }, { organizationKey })).results;
    indices.forEach((index, position) => { generated[index] = results[position]!; });
  }));
  const captionDurationMs = performance.now() - captionStartedAt;
  const embeddings = await Promise.all(generated.map(({ caption }, index) => embedText({ text: `${rows[index]!.filename}\n\n${caption}` })));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!, result = generated[index]!, hash = hashes[index]!;
    const embedding = currentEmbeddingSchema.parse(embeddings[index]);
    const segments = perceptualHashSegments(hash);
    const now = new Date().toISOString();
    const write = await db.query<string>(`
      LET caption = DOCUMENT(imageCaptions, @key)
      FILTER caption != null && caption._rev == @revision && caption.scopeKey == @scopeKey
      UPDATE caption WITH { caption: @caption, score: @score, scoreVersion: 1, embedding: @embedding, perceptualHash: @hash, hashAlgorithm: "phash-64-dct-v1", hashSegment0: @segment0, hashSegment1: @segment1, hashSegment2: @segment2, hashSegment3: @segment3, updatedAt: @now } IN imageCaptions
      FOR image IN images
        FILTER image.imageCaptionKey == @key && image.scopeKey == @scopeKey
        UPDATE image WITH { caption: @caption, embedding: @embedding, updatedAt: @now } IN images
        RETURN NEW._key
    `, { key: row.key, revision: row.revision, scopeKey: row.scopeKey, caption: result.caption, score: result.score, embedding, hash, segment0: segments[0], segment1: segments[1], segment2: segments[2], segment3: segments[3], now });
    if (await write.next()) updated += 1;
    after = row.key;
  }
  console.log(`Gallery caption batch size=${rows.length} hashMs=${Math.round(hashDurationMs)} captionMs=${Math.round(captionDurationMs)} totalMs=${Math.round(performance.now() - startedAt)}`);
}

const remaining = await staleCount();
console.log(`Gallery caption backfill updated=${updated} remaining=${remaining}`);
if (remaining > 0) throw new Error('Gallery caption backfill left stale records. Resolve missing objects or concurrent updates, then rerun.');
