import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { closeDb, db } from "@/lib/db/client";
import { getPersonalAuthContext } from "@/lib/db/personal-auth-context.node";
import { galleryOperations, type GalleryOperationContext } from "@/lib/gallery/operations";
import { processGalleryUploadBatch } from "@/lib/gallery/upload-processing";

type UploadReservation = {
  uploadKey: string;
  imageKey: string;
  url: string;
  headers: Record<string, string>;
};

function argument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

async function waitForUploads(uploadKeys: string[], context: GalleryOperationContext) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await galleryOperations.uploadStatus({ uploadKeys }, context);
    if (status.jobs.some((job) => job.status === "failed"))
      throw new Error(`Gallery processing failed for ${uploadKeys.join(", ")}.`);
    if (status.jobs.every((job) => job.status === "completed")) return;
    await Bun.sleep(1_000);
  }
  throw new Error(`Timed out waiting for Gallery to process ${uploadKeys.join(", ")}.`);
}

async function main() {
  const sourceName = argument("--source-collection").trim();
  const collectionName = argument("--collection").trim();
  const inputDirectory = path.resolve(argument("--input"));
  const replace = process.argv.includes("--replace");
  const cursor = await db.query(
    `FOR collection IN collections
      FILTER LOWER(collection.name) == LOWER(@sourceName)
      LET scope = DOCUMENT(scopes, collection.scopeKey)
      LET membership = DOCUMENT(userTeams, collection.ownerKey)
      FILTER scope != null && membership != null
      RETURN { scopeKey: collection.scopeKey, userKey: membership.userId }`,
    { sourceName },
  );
  const sources = await cursor.all() as Array<{ scopeKey: string; userKey: string }>;
  if (sources.length !== 1)
    throw new Error(`Expected one source collection named "${sourceName}", found ${sources.length}.`);

  const [source] = sources;
  const personal = await getPersonalAuthContext(source.userKey);
  if (!personal || personal.scope.key !== source.scopeKey)
    throw new Error("The screenshots collection is not in an available personal workspace.");
  const context: GalleryOperationContext = {
    teamKey: personal.team.key,
    scopeKey: personal.scope.key,
    membership: personal.membership,
  };
  const existingCursor = await db.query(
    "FOR collection IN collections FILTER collection.scopeKey == @scopeKey && LOWER(collection.name) == LOWER(@collectionName) RETURN collection._key",
    { scopeKey: context.scopeKey, collectionName },
  );
  const existing = await existingCursor.all() as string[];
  if (existing.length > 0 && !replace)
    throw new Error(`A collection named "${collectionName}" already exists in this Gallery scope.`);
  if (existing.length > 0)
    await galleryOperations.deleteCollection({ collectionKey: existing[0]! }, context);

  const entries = await readdir(inputDirectory);
  const files = (await Promise.all(entries
    .filter((entry) => /^\d+\.png$/i.test(entry))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map(async (filename) => ({ filename, path: path.join(inputDirectory, filename), stats: await stat(path.join(inputDirectory, filename)) }))))
    .filter(({ stats }) => stats.isFile());
  if (files.length === 0) throw new Error(`No rendered PNG files found in ${inputDirectory}.`);

  const created = await galleryOperations.createCollection({ name: collectionName, isFavorite: false }, context);
  for (const batch of chunks(files, 20)) {
    const reserved = await galleryOperations.reserveUploads({
      collectionKey: created.key,
      files: batch.map(({ filename, stats }) => ({
        clientKey: filename,
        filename: `vorinthex-${filename}`,
        sizeBytes: stats.size,
        processingMode: "library",
      })),
    }, context) as { uploads: UploadReservation[] };
    if (reserved.uploads.length !== batch.length)
      throw new Error("Gallery returned an incomplete upload reservation batch.");
    for (const [index, upload] of reserved.uploads.entries()) {
      const file = batch[index];
      if (!file) throw new Error(`Missing file for upload reservation ${upload.uploadKey}.`);
      const response = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: await readFile(file.path) });
      if (!response.ok) throw new Error(`Upload failed for ${file.filename}: ${response.status} ${response.statusText}`);
    }
    const batchUploadKeys = reserved.uploads.map(({ uploadKey }) => uploadKey);
    await galleryOperations.completeUploads({ uploadKeys: batchUploadKeys }, context);
    await processGalleryUploadBatch(batchUploadKeys);
    await waitForUploads(batchUploadKeys, context);
  }

  const relationCursor = await db.query(
    "FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey RETURN 1",
    { scopeKey: context.scopeKey, collectionKey: created.key },
  );
  const count = (await relationCursor.all()).length;
  if (count !== files.length) throw new Error(`Expected ${files.length} rendered images, found ${count}.`);
  console.log(`Created ${collectionName} with ${count} rendered images.`);
}

try {
  await main();
} finally {
  await closeDb();
}
