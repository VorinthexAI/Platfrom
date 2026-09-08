import { expect, test } from "bun:test";
import { newId } from "@/lib/ids";
import { galleryUploadSchema } from "@/lib/db/gallery-uploads.node";
import { galleryOperations } from "./operations";

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
