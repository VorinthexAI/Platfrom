import { db, withTransaction } from "@/lib/db/client";
import { toArangoDoc, withArangoKey } from "@/lib/db/base";
import { imageSchema } from "@/lib/db/images.node";
import { collectionSchema } from "@/lib/db/collections.node";
import { collectionImageSchema } from "@/lib/db/collection-images.node";

export interface MediaLibraryDatabase {
  query(
    query: string,
    bindVars?: Record<string, unknown>,
  ): Promise<{ all(): Promise<unknown[]> }>;
}
export type MediaLibraryTransactionRunner = <T>(
  operation: (database: MediaLibraryDatabase) => Promise<T>,
) => Promise<T>;
type Image = ReturnType<typeof imageSchema.parse>;
type Collection = ReturnType<typeof collectionSchema.parse>;
type CollectionImage = ReturnType<typeof collectionImageSchema.parse>;
const transactionCollections = [
  "images",
  "collections",
  "collectionImages",
  "tags",
  "tagAssignments",
  "documents",
  "places",
  "scopes",
  "scopeMembers",
  "userTeams",
  "users",
] as const;
const defaultTransactionRunner: MediaLibraryTransactionRunner = (operation) =>
  withTransaction([...transactionCollections], (transaction) =>
    operation(transaction),
  );

function parse<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  return schema.parse(withArangoKey(value as Record<string, unknown>));
}
async function one(
  database: MediaLibraryDatabase,
  query: string,
  bindVars: Record<string, unknown>,
): Promise<unknown | null> {
  return (await (await database.query(query, bindVars)).all())[0] ?? null;
}
const activeActor = `LET actorMembership = DOCUMENT(userTeams, @actorKey) LET actorScope = DOCUMENT(scopes, @scopeKey) FILTER actorMembership != null && actorMembership.status == "active" FILTER actorScope != null && actorMembership.teamKey == actorScope.teamKey LET elevated = actorMembership.teamRole IN ["owner", "admin"] LET scopedRole = FIRST(FOR scopeMember IN scopeMembers FILTER scopeMember.scopeKey == @scopeKey && scopeMember.userTeamKey == @actorKey && scopeMember.status == "active" LIMIT 1 RETURN scopeMember.role) LET scoped = scopedRole != null LET writable = scopedRole IN ["owner", "admin", "moderator"]`;

export interface MediaLibraryRepository {
  getImage(scopeKey: string, imageKey: string): Promise<Image | null>;
  getCollection(
    scopeKey: string,
    collectionKey: string,
  ): Promise<Collection | null>;
  ownsImage(
    scopeKey: string,
    imageKey: string,
    ownerKey: string,
  ): Promise<boolean>;
  canAccessImage(
    scopeKey: string,
    imageKey: string,
    actorKey: string,
  ): Promise<boolean>;
  canAccessCollection(
    scopeKey: string,
    collectionKey: string,
    actorKey: string,
  ): Promise<boolean>;
  canManageScope(scopeKey: string, actorKey: string): Promise<boolean>;
  ownsCollection(
    scopeKey: string,
    collectionKey: string,
    ownerKey: string,
  ): Promise<boolean>;
  addImageToCollection(relation: CollectionImage): Promise<CollectionImage>;
  copyImageToCollection(relation: CollectionImage): Promise<CollectionImage>;
  moveImageBetweenCollections(
    sourceCollectionKey: string,
    relation: CollectionImage,
  ): Promise<CollectionImage>;
  setCollectionCoverImage(
    scopeKey: string,
    collectionKey: string,
    imageKey: string,
    ownerKey: string,
    now: string,
  ): Promise<Collection | null>;
}

export interface AccessibleImageSearchInput {
  teamKey: string;
  scopeKey: string;
  actorKey: string;
  collectionKey?: string;
  embedding: number[];
  threshold?: number;
  limit: number;
  createdFrom?: string;
  createdTo?: string;
}

export interface AccessibleImageSearchResult {
  image: Image;
  score: number;
  collections: Array<{ key: string; name: string }>;
}

export async function searchAccessibleImages(
  input: AccessibleImageSearchInput,
  database: MediaLibraryDatabase = db,
): Promise<AccessibleImageSearchResult[]> {
  const cursor = await database.query(
    `
    LET actorMembership = DOCUMENT(userTeams, @actorKey)
    LET actorScope = DOCUMENT(scopes, @scopeKey)
    FILTER actorMembership != null
    FILTER actorMembership.status == "active"
    FILTER actorMembership.teamKey == @teamKey
    FILTER actorScope != null
    FILTER actorScope.teamKey == @teamKey
    LET elevated = actorMembership.teamRole IN ["owner", "admin"]
    LET scoped = LENGTH(
      FOR scopeMember IN scopeMembers
        FILTER scopeMember.scopeKey == @scopeKey
        FILTER scopeMember.userTeamKey == @actorKey
        FILTER scopeMember.status == "active"
        LIMIT 1
        RETURN 1
    ) > 0
    LET scopeRole = FIRST(
      FOR scopeMember IN scopeMembers
        FILTER scopeMember.scopeKey == @scopeKey && scopeMember.userTeamKey == @actorKey && scopeMember.status == "active"
        LIMIT 1
        RETURN scopeMember.role
    )
    LET privileged = elevated || scopeRole IN ["owner", "admin"]
    FOR image IN images
      FILTER image.scopeKey == @scopeKey
      FILTER @collectionKey == null || LENGTH(
        FOR collectionImage IN collectionImages
          FILTER collectionImage.scopeKey == @scopeKey
          FILTER collectionImage.collectionKey == @collectionKey
          FILTER collectionImage.imageKey == image._key
          LIMIT 1
          RETURN 1
      ) > 0
      LET collectionAccess = LENGTH(
        FOR relation IN collectionImages
          FILTER relation.scopeKey == @scopeKey
          FILTER relation.imageKey == image._key
          LET collection = DOCUMENT(collections, relation.collectionKey)
          FILTER collection != null
          FILTER collection.scopeKey == @scopeKey
          LET managedViewer = collection.purpose IN ["email-media", "generated-media", "scope-directory"] && collection.mutationPolicy == "system-only" && scoped
          FILTER managedViewer || collection.ownerKey == @actorKey
          RETURN 1
      ) > 0
      LET relationCount = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == image._key RETURN 1)
      FILTER privileged || (image.createdByKey == @actorKey && relationCount == 0) || collectionAccess
      FILTER IS_ARRAY(image.embedding)
      FILTER LENGTH(image.embedding) == @dimensions
      FILTER LENGTH(image.embedding[* FILTER !IS_NUMBER(CURRENT)]) == 0
      LET score = COSINE_SIMILARITY(image.embedding, @embedding)
      FILTER IS_NUMBER(score)
      FILTER @threshold == null || score >= @threshold
      FILTER @createdFrom == null || image.createdAt >= @createdFrom
      FILTER @createdTo == null || image.createdAt <= @createdTo
      LET accessibleCollections = (
        FOR relation IN collectionImages
          FILTER relation.scopeKey == @scopeKey
          FILTER relation.imageKey == image._key
          LET collection = DOCUMENT(collections, relation.collectionKey)
          FILTER collection != null
          FILTER collection.scopeKey == @scopeKey
          LET managedViewer = collection.purpose IN ["email-media", "generated-media", "scope-directory"] && collection.mutationPolicy == "system-only" && scoped
          FILTER managedViewer || collection.ownerKey == @actorKey
          SORT relation.createdAt ASC
          LIMIT 3
          RETURN { key: collection._key, name: collection.name }
      )
      SORT score DESC, image._key ASC
      LIMIT @limit
      RETURN { image, score, collections: accessibleCollections }
  `,
    {
      teamKey: input.teamKey,
      scopeKey: input.scopeKey,
      actorKey: input.actorKey,
      collectionKey: input.collectionKey ?? null,
      embedding: input.embedding,
      dimensions: input.embedding.length,
      threshold: input.threshold ?? null,
      createdFrom: input.createdFrom ?? null,
      createdTo: input.createdTo ?? null,
      limit: input.limit,
    },
  );
  return (await cursor.all()).map((value) => {
    const row = value as {
      image?: unknown;
      score?: unknown;
      collections?: unknown;
    };
    if (typeof row.score !== "number" || !Number.isFinite(row.score))
      throw new Error("Image similarity query returned an invalid score.");
    const collections = Array.isArray(row.collections)
      ? (row.collections as Array<{ key: string; name: string }>)
      : [];
    return {
      image: parse(imageSchema, row.image),
      score: row.score,
      collections,
    };
  });
}

export function createMediaLibraryRepository(
  database: MediaLibraryDatabase = db,
  runTransaction: MediaLibraryTransactionRunner = defaultTransactionRunner,
): MediaLibraryRepository {
  const add = async (relation: CollectionImage) => {
    const valid = collectionImageSchema.parse(relation);
    const value = await one(
      database,
      `LET image = DOCUMENT(images, @imageKey) LET collection = DOCUMENT(collections, @collectionKey) ${activeActor} LET sourceAccess = scoped || elevated || LENGTH(FOR link IN collectionImages FILTER link.scopeKey == @scopeKey && link.imageKey == @imageKey LET sourceCollection = DOCUMENT(collections, link.collectionKey) FILTER sourceCollection != null && sourceCollection.mutationPolicy != "system-only" && sourceCollection.ownerKey == @addedByKey LIMIT 1 RETURN 1) > 0 FILTER image != null && collection != null FILTER image.scopeKey == @scopeKey && collection.scopeKey == @scopeKey && image.mutationPolicy != "system-only" && collection.mutationPolicy != "system-only" && collection.ownerKey == @addedByKey && sourceAccess UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey: @imageKey } INSERT @relation UPDATE {} IN collectionImages RETURN NEW`,
      {
        scopeKey: valid.scopeKey,
        collectionKey: valid.collectionKey,
        imageKey: valid.imageKey,
        addedByKey: valid.addedByKey,
        actorKey: valid.addedByKey,
        relation: toArangoDoc(valid),
      },
    );
    if (!value)
      throw new MediaLibraryReferenceError(
        "Source image access, destination ownership, and live same-scope resources are required",
      );
    return parse(collectionImageSchema, value);
  };
  const owns = async (
    kind: "image" | "collection",
    scopeKey: string,
    resourceKey: string,
    ownerKey: string,
  ) =>
    Boolean(
      await one(
        database,
        kind === "collection"
          ? `LET target = DOCUMENT(collections, @resourceKey) ${activeActor} FILTER target != null && target.scopeKey == @scopeKey && target.mutationPolicy != "system-only" && target.ownerKey == @ownerKey RETURN true`
          : `LET target = DOCUMENT(images, @resourceKey) ${activeActor} FILTER target != null && target.scopeKey == @scopeKey && target.mutationPolicy != "system-only" FILTER writable || elevated || LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @resourceKey LET collection = DOCUMENT(collections, relation.collectionKey) FILTER collection != null && collection.mutationPolicy != "system-only" && collection.ownerKey == @ownerKey LIMIT 1 RETURN 1) > 0 RETURN true`,
        { scopeKey, resourceKey, ownerKey, actorKey: ownerKey },
      ),
    );
  return {
    async getImage(scopeKey, imageKey) {
      const value = await one(
        database,
        "FOR image IN images FILTER image._key == @imageKey && image.scopeKey == @scopeKey LIMIT 1 RETURN image",
        { scopeKey, imageKey },
      );
      return value ? parse(imageSchema, value) : null;
    },
    async getCollection(scopeKey, collectionKey) {
      const value = await one(
        database,
        "FOR collection IN collections FILTER collection._key == @collectionKey && collection.scopeKey == @scopeKey LIMIT 1 RETURN collection",
        { scopeKey, collectionKey },
      );
      return value ? parse(collectionSchema, value) : null;
    },
    ownsImage: (scopeKey, imageKey, ownerKey) =>
      owns("image", scopeKey, imageKey, ownerKey),
    canAccessImage: async (scopeKey, imageKey, actorKey) =>
      Boolean(
        await one(
          database,
          `LET image = DOCUMENT(images, @imageKey) ${activeActor} LET privileged = elevated || scopedRole IN ["owner", "admin"] FILTER image != null && image.scopeKey == @scopeKey LET relationCount = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey RETURN 1) FILTER privileged || (image.createdByKey == @actorKey && relationCount == 0) || LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @imageKey LET collection = DOCUMENT(collections, relation.collectionKey) FILTER collection != null FILTER collection.purpose IN ["email-media", "generated-media", "scope-directory"] && collection.mutationPolicy == "system-only" ? scoped : collection.mutationPolicy != "system-only" && collection.ownerKey == @actorKey RETURN 1) > 0 RETURN true`,
          { scopeKey, imageKey, actorKey },
        ),
      ),
    canAccessCollection: async (scopeKey, collectionKey, actorKey) =>
      Boolean(
        await one(
          database,
          `LET collection = DOCUMENT(collections, @collectionKey) ${activeActor} LET privileged = elevated || scopedRole IN ["owner", "admin"] FILTER collection != null && collection.scopeKey == @scopeKey LET managedViewer = collection.purpose IN ["email-media", "generated-media", "scope-directory"] && collection.mutationPolicy == "system-only" && scoped FILTER privileged || managedViewer || (collection.mutationPolicy != "system-only" && collection.ownerKey == @actorKey) RETURN true`,
          { scopeKey, collectionKey, actorKey },
        ),
      ),
    canManageScope: async (scopeKey, actorKey) =>
      Boolean(
        await one(
          database,
          `${activeActor} FILTER writable || elevated RETURN true`,
          { scopeKey, actorKey },
        ),
      ),
    ownsCollection: (scopeKey, collectionKey, ownerKey) =>
      owns("collection", scopeKey, collectionKey, ownerKey),
    addImageToCollection: add,
    copyImageToCollection: add,
    moveImageBetweenCollections(sourceCollectionKey, relation) {
      return runTransaction(async (transaction) => {
        const bound = createMediaLibraryRepository(transaction, runTransaction);
        const source = await one(
          transaction,
          `${activeActor} LET image = DOCUMENT(images, @imageKey) LET sourceCollection = DOCUMENT(collections, @sourceCollectionKey) LET current = FIRST(FOR link IN collectionImages FILTER link.scopeKey == @scopeKey && link.collectionKey == @sourceCollectionKey && link.imageKey == @imageKey LIMIT 1 RETURN link) FILTER image != null && sourceCollection != null && current != null && (elevated || sourceCollection.ownerKey == @actorKey) RETURN current`,
          {
            scopeKey: relation.scopeKey,
            sourceCollectionKey,
            imageKey: relation.imageKey,
            actorKey: relation.addedByKey,
          },
        );
        if (!source)
          throw new MediaLibraryReferenceError(
            "Source collection does not contain an owned image",
          );
        const destination = await bound.addImageToCollection(relation);
        if (sourceCollectionKey !== relation.collectionKey) {
          await transaction.query(
            "FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @sourceCollectionKey && relation.imageKey == @imageKey REMOVE relation IN collectionImages",
            {
              scopeKey: relation.scopeKey,
              sourceCollectionKey,
              imageKey: relation.imageKey,
            },
          );
          await transaction.query(
            "FOR collection IN collections FILTER collection._key == @sourceCollectionKey && collection.scopeKey == @scopeKey && collection.coverImageKey == @imageKey UPDATE collection WITH { coverImageKey: null, updatedAt: @now } IN collections OPTIONS { keepNull: false }",
            {
              scopeKey: relation.scopeKey,
              sourceCollectionKey,
              imageKey: relation.imageKey,
              now: relation.createdAt,
            },
          );
        }
        return destination;
      });
    },
    async setCollectionCoverImage(
      scopeKey,
      collectionKey,
      imageKey,
      ownerKey,
      now,
    ) {
      const value = await one(
        database,
        `LET image = DOCUMENT(images, @imageKey) ${activeActor} LET relation = FIRST(FOR link IN collectionImages FILTER link.scopeKey == @scopeKey && link.collectionKey == @collectionKey && link.imageKey == @imageKey LIMIT 1 RETURN link) FOR collection IN collections FILTER collection._key == @collectionKey && collection.scopeKey == @scopeKey && collection.ownerKey == @ownerKey && collection.mutationPolicy != "system-only" FILTER image != null && image.scopeKey == @scopeKey && relation != null LIMIT 1 UPDATE collection WITH { coverImageKey: @imageKey, updatedAt: @now } IN collections RETURN NEW`,
        {
          scopeKey,
          collectionKey,
          imageKey,
          ownerKey,
          actorKey: ownerKey,
          now,
        },
      );
      return value ? parse(collectionSchema, value) : null;
    },
  };
}

export class MediaLibraryReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaLibraryReferenceError";
  }
}
let defaultRepository: MediaLibraryRepository | undefined;
export function getDefaultMediaLibraryRepository(): MediaLibraryRepository {
  return (defaultRepository ??= createMediaLibraryRepository());
}
