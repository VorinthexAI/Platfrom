import { expect, test } from "bun:test";
import { newId } from "@/lib/ids";
import { galleryUploadSchema } from "@/lib/db/gallery-uploads.node";
import { galleryOperations, galleryUploadPresignInputSchema, projectGalleryCollection } from "./operations";
import { collectionSchema } from "@/lib/db/collections.node";
import { EMBEDDING_DIMENSIONS } from "@/lib/embeddings";

test("accepts twenty individually valid images without an aggregate upload-size cap", () => {
  const sizeBytes = 20 * 1024 * 1024;
  const files = Array.from({ length: 20 }, (_, index) => ({ clientKey: `image-${index}`, filename: `image-${index}.png`, sizeBytes }));
  const parsed = galleryUploadPresignInputSchema.parse({ collectionKey: null, files });
  expect(parsed.files).toHaveLength(20);
  expect(parsed.files.reduce((total, file) => total + file.sizeBytes, 0)).toBe(400 * 1024 * 1024);
  expect(() => galleryUploadPresignInputSchema.parse({ collectionKey: null, files: [...files, { clientKey: "image-20", filename: "image-20.png", sizeBytes: 1 }] })).toThrow();
  expect(() => galleryUploadPresignInputSchema.parse({ collectionKey: null, files: [{ clientKey: "large", filename: "large.png", sizeBytes: sizeBytes + 1 }] })).toThrow();
});

test.each([
  ["generated-media", true],
  ["email-media", true],
  ["place-media", true],
  ["scope-directory", false],
] as const)("projects %s managed collection contribution as %s", (purpose, canContribute) => {
  const now = new Date().toISOString();
  const collection = collectionSchema.parse({ key: newId(), scopeKey: newId(), name: purpose, purpose, mutationPolicy: "system-only", embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: now, updatedAt: now });
  expect(projectGalleryCollection(collection, 0, null, newId(), "viewer", false).access).toEqual({ canRead: true, canContribute, canManage: false });
});

test("reserves managed-collection uploads through contribution authorization", async () => {
  const teamKey = "team", scopeKey = newId(), actorKey = newId(), collectionKey = newId();
  let checked = "";
  const result = await galleryOperations.reserveUploads({ collectionKey, files: [{ clientKey: "capture", filename: "capture.png", sizeBytes: 8 }] }, {
    teamKey,
    scopeKey,
    membership: { key: actorKey, teamKey, userId: newId(), status: "active" } as never,
    canContributeToCollection: async (_scopeKey, key) => { checked = key; return true; },
    signUpload: async () => "https://uploads.example/image.png",
    insertUploads: async (uploads) => uploads,
    publishUserEvent: async () => {},
  });
  expect(checked).toBe(collectionKey);
  expect(result.uploads).toHaveLength(1);

  await expect(galleryOperations.reserveUploads({ collectionKey, files: [{ clientKey: "blocked", filename: "blocked.png", sizeBytes: 8 }] }, {
    teamKey,
    scopeKey,
    membership: { key: actorKey, teamKey, userId: newId(), status: "active" } as never,
    canContributeToCollection: async () => false,
  })).rejects.toMatchObject({ code: "GALLERY_COLLECTION_READ_ONLY" });
});

test("favorites readable system-managed images without granting full mutation", async () => {
  const teamKey = "team", scopeKey = newId(), actorKey = newId(), imageKey = newId();
  let favoriteAuthorized = false;
  let favoriteWrite = false;

  await expect(galleryOperations.setFavorite({ imageKey, isFavorite: true }, {
    teamKey, scopeKey, membership: { key: actorKey, teamKey, userId: newId(), status: "active" } as never,
    canFavoriteImage: async () => { favoriteAuthorized = true; return true; },
    canMutateImage: async () => { throw new Error("full mutation authorization must not run"); },
    setImageFavorite: async () => { favoriteWrite = true; return null; },
  })).rejects.toMatchObject({ code: "GALLERY_IMAGE_NOT_FOUND" });
  expect(favoriteAuthorized).toBe(true);
  expect(favoriteWrite).toBe(true);

  await expect(galleryOperations.updateImage({ imageKey, name: "renamed.png", isFavorite: true }, {
    teamKey, scopeKey, membership: { key: actorKey, teamKey, userId: newId(), status: "active" } as never,
    canMutateImage: async () => false,
  })).rejects.toMatchObject({ code: "GALLERY_IMAGE_READ_ONLY" });
});

test("cleans registered upload storage when the durable queue transition rejects the reservation", async () => {
  const now = new Date();
  const teamKey = "team";
  const scopeKey = newId();
  const actorKey = newId();
  const userKey = newId();
  const upload = galleryUploadSchema.parse({
    key: newId(),
    teamKey,
    scopeKey,
    actorKey,
    imageKey: newId(),
    collectionKey: null,
    filename: "cover.png",
    mimeType: "image/png",
    sizeBytes: 8,
    storageKey: `pending/gallery/${scopeKey}/cover.png`,
    processingMode: "cover",
    status: "reserved",
    processingLeaseId: null,
    errorCode: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  });
  const recorded: string[] = [];
  const deleted: string[] = [];

  await expect(galleryOperations.completeUploads({ uploadKeys: [upload.key] }, {
    teamKey,
    scopeKey,
    membership: { key: actorKey, teamKey, userId: userKey, status: "active" } as never,
    getUpload: async () => upload,
    verifyUploadObject: async () => true,
    recordStoredObject: async (input) => { recorded.push(input.storageKey); return {} as never; },
    queueUploads: async () => null,
    deleteStorageObject: async (storageKey) => { deleted.push(storageKey); },
  })).rejects.toThrow("upload reservations");

  expect(recorded).toEqual([upload.storageKey]);
  expect(deleted).toEqual([upload.storageKey]);
});
