import { db } from '@/lib/db/client';
import { buildEmbeddingText, isArangoNotFoundError, isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { embedText, embeddingMetadata } from '@/lib/embeddings';
import {
  SCOPE_SCOPES_COLLECTION,
  SCOPE_MEMBERS_COLLECTION,
  SCOPES_COLLECTION,
  scopeSchema,
  scopesEmbedKeys,
  scopeScopeSchema,
  type Scope,
  type ScopeScope,
} from './schema';
import {
  DuplicateScopeRelationError,
  DuplicateScopeSlugError,
  ScopeAlreadyHasParentError,
  ScopeCycleError,
  ScopeNotFoundError,
  ScopeOrganizationMismatchError,
  ScopeRelationNotFoundError,
  type ScopeRepository,
  type ScopesDatabase,
} from './types';

export function createScopeRepository(
  database: ScopesDatabase = db,
  generateEmbedding: (text: string) => Promise<number[]> = async (text) => embedText({ text }),
): ScopeRepository {
  async function requireScope(scopeKey: string): Promise<Scope> {
    try {
      const doc = await database.collection(SCOPES_COLLECTION).document(scopeKey);
      return scopeSchema.parse(withArangoKey(doc as Record<string, unknown>));
    } catch (error) {
      if (isArangoNotFoundError(error)) throw new ScopeNotFoundError(scopeKey);
      throw error;
    }
  }

  async function listRelations(parentKey: string): Promise<ScopeScope[]> {
    const cursor = await database.query(
      `
        FOR relation IN @@collection
          FILTER relation.parentKey == @parentKey
          SORT relation._key ASC
          RETURN relation
      `,
      { '@collection': SCOPE_SCOPES_COLLECTION, parentKey },
    );
    const docs = await cursor.all();
    return (docs as Record<string, unknown>[]).map((doc) => scopeScopeSchema.parse(withArangoKey(doc)));
  }

  async function wouldCreateCycle(parentKey: string, childKey: string): Promise<boolean> {
    const pending = [childKey];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.shift()!;
      if (current === parentKey) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const children = await listRelations(current);
      pending.push(...children.map((relation) => relation.childKey));
    }
    return false;
  }

  return {
    async createScope(input) {
      const parsed = scopeSchema.parse({ ...input, key: input.key ?? newId() });
      const scope = {
        ...parsed,
        embedding: await generateEmbedding(buildEmbeddingText(scopesEmbedKeys.options, parsed)!),
      } satisfies Scope;
      try {
        const result = await database.collection(SCOPES_COLLECTION).save(toArangoDoc({ ...scope, ...embeddingMetadata() }), { returnNew: true });
        const saved = (result as { new?: Record<string, unknown> }).new;
        const created = (saved ? scopeSchema.parse(withArangoKey(saved)) : scope) satisfies Scope;
        const { ensureGeneratedDocumentFolders } = await import('@/lib/generated-documents/folders');
        await ensureGeneratedDocumentFolders(database, created.key);
        const { ensureMailFolders } = await import('@/lib/email-inbox/folders');
        await ensureMailFolders(database, created.key);
        return created;
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) {
          throw new DuplicateScopeSlugError(scope.organizationKey, scope.slug);
        }
        throw error;
      }
    },

    async updateScope(scopeKey, input) {
      const current = await requireScope(scopeKey);
      const parsed = scopeSchema.parse({ ...current, ...input });
      const embedding = await generateEmbedding(buildEmbeddingText(scopesEmbedKeys.options, parsed)!);
      const result = await database.collection(SCOPES_COLLECTION).update(scopeKey, { ...input, embedding, ...embeddingMetadata() }, { returnNew: true });
      const saved = (result as { new?: Record<string, unknown> }).new;
      return saved ? scopeSchema.parse(withArangoKey(saved)) : { ...parsed, embedding };
    },

    async getScopeByKey(scopeKey) {
      try {
        const doc = await database.collection(SCOPES_COLLECTION).document(scopeKey);
        return scopeSchema.parse(withArangoKey(doc as Record<string, unknown>));
      } catch (error) {
        if (isArangoNotFoundError(error)) return null;
        throw error;
      }
    },

    async listScopes(organizationKey) {
      const validOrganizationKey = parseOrganizationKey(organizationKey);
      const cursor = await database.query(
        `
          FOR scope IN @@collection
            FILTER scope.organizationKey == @organizationKey
              && REGEX_TEST(scope._key, "^c[^\\\\s-]{8,}$", true)
            SORT scope.name ASC, scope._key ASC
            RETURN scope
        `,
        { '@collection': SCOPES_COLLECTION, organizationKey: validOrganizationKey },
      );
      const docs = await cursor.all();
      return (docs as Record<string, unknown>[]).map((doc) => scopeSchema.parse(withArangoKey(doc)));
    },

    async removeScope(scopeKey) {
      await requireScope(scopeKey);
      await database.query(`
        LET managedCollections = (FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.purpose == "place-media" && collection.mutationPolicy == "system-only" RETURN collection._key)
        LET managedImages = UNIQUE(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey IN managedCollections LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.scopeKey == @scopeKey && image.mutationPolicy == "system-only" RETURN { key: image._key, storageKey: image.storageKey, captionKey: image.imageCaptionKey })
        LET imageKeys = managedImages[*].key
        LET captionKeys = managedImages[*].captionKey
        LET cleanupGeneratedDocumentBindings = (FOR binding IN generatedDocumentBindings FILTER binding.scopeKey == @scopeKey REMOVE binding IN generatedDocumentBindings RETURN 1)
        LET cleanupTripAttachments = (FOR attachment IN tripAttachments FILTER attachment.scopeKey == @scopeKey REMOVE attachment IN tripAttachments RETURN 1)
        LET cleanupTripCreationReceipts = (FOR receipt IN tripCreationReceipts FILTER receipt.scopeKey == @scopeKey REMOVE receipt IN tripCreationReceipts RETURN 1)
        LET cleanupPlaceImages = (FOR relation IN placeImages FILTER relation.scopeKey == @scopeKey REMOVE relation IN placeImages RETURN 1)
        LET cleanupTripPlaces = (FOR relation IN tripPlaces FILTER relation.scopeKey == @scopeKey REMOVE relation IN tripPlaces RETURN 1)
        LET cleanupTrips = (FOR trip IN trips FILTER trip.scopeKey == @scopeKey REMOVE trip IN trips RETURN 1)
        LET cleanupCollectionImages = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey IN managedCollections REMOVE relation IN collectionImages RETURN 1)
        LET cleanupIdentities = (FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.imageKey IN imageKeys REMOVE relation IN imageIdentities RETURN 1)
        LET cleanupHighlights = (FOR highlight IN imageCollecitionHightlights FILTER highlight.scopeKey == @scopeKey && highlight.collectionKey IN managedCollections REMOVE highlight IN imageCollecitionHightlights RETURN 1)
        LET cleanupMemories = (FOR memory IN imageCollectionMemories FILTER memory.scopeKey == @scopeKey && memory.imageKey IN imageKeys REMOVE memory IN imageCollectionMemories RETURN 1)
        LET cleanupInvites = (FOR invite IN collectionInvites FILTER invite.scopeKey == @scopeKey && invite.collectionKey IN managedCollections REMOVE invite IN collectionInvites RETURN 1)
        LET cleanupMembers = (FOR member IN collectionMembers FILTER member.scopeKey == @scopeKey && member.collectionKey IN managedCollections REMOVE member IN collectionMembers RETURN 1)
        LET cleanupTags = (FOR assignment IN tagAssignments FILTER assignment.scopeKey == @scopeKey && ((assignment.sourceType == "image" && assignment.sourceKey IN imageKeys) || (assignment.sourceType == "collection" && assignment.sourceKey IN managedCollections) || assignment.sourceType == "place") REMOVE assignment IN tagAssignments RETURN 1)
        LET cleanupShares = (FOR share IN shares FILTER share.scopeKey == @scopeKey && ((share.sourceType == "image" && share.sourceKey IN imageKeys) || (share.sourceType == "collection" && share.sourceKey IN managedCollections) || share.sourceType == "place") REMOVE share IN shares RETURN 1)
        LET cleanupHiddens = (FOR hidden IN userHiddens FILTER (hidden.source == "image" && hidden.sourceKey IN imageKeys) || (hidden.source == "collection" && hidden.sourceKey IN managedCollections) REMOVE hidden IN userHiddens RETURN 1)
        LET cleanupPlaces = (FOR place IN places FILTER place.scopeKey == @scopeKey REMOVE place IN places RETURN 1)
        LET cleanupImages = (FOR image IN images FILTER image._key IN imageKeys REMOVE image IN images RETURN 1)
        LET cleanupCaptions = (FOR caption IN imageCaptions FILTER caption._key IN captionKeys FILTER LENGTH(FOR retained IN images FILTER retained.imageCaptionKey == caption._key LIMIT 1 RETURN 1) == 0 REMOVE caption IN imageCaptions RETURN 1)
        LET cleanupCollections = (FOR collection IN collections FILTER collection._key IN managedCollections REMOVE collection IN collections RETURN 1)
        LET mailFolderKeys = (FOR folder IN folders FILTER folder.scopeKey == @scopeKey && STARTS_WITH(folder.purpose || "", "communication-mail-") RETURN folder._key)
        LET cleanupMailDocuments = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document.folderKey IN mailFolderKeys REMOVE document IN documents RETURN 1)
        LET cleanupMailFolders = (FOR folder IN folders FILTER folder._key IN mailFolderKeys REMOVE folder IN folders RETURN 1)
        LET cleanupMailConnectors = (FOR connector IN organizationConnectors FILTER connector.scopeKey == @scopeKey REMOVE connector IN organizationConnectors RETURN 1)
        LET deletionJobs = (FOR image IN managedImages FILTER image.storageKey != null UPSERT { storageKey: image.storageKey } INSERT { storageKey: image.storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs RETURN 1)
        LET cleanupScopeRelations = (FOR relation IN scopeScopes FILTER relation.parentKey == @scopeKey || relation.childKey == @scopeKey REMOVE relation IN scopeScopes RETURN 1)
        LET cleanupScopeMembers = (FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey REMOVE member IN scopeMembers RETURN 1)
        LET cleanupScope = (FOR scope IN scopes FILTER scope._key == @scopeKey REMOVE scope IN scopes RETURN 1)
        RETURN { collectionCount: LENGTH(managedCollections), imageCount: LENGTH(managedImages) }
      `, { scopeKey, now: new Date().toISOString() });
    },

    async addScopeRelation(parentKey, childKey) {
      const [parent, child] = await Promise.all([requireScope(parentKey), requireScope(childKey)]);
      const relation = scopeScopeSchema.parse({ key: newId(), parentKey, childKey, level: parent.level + 1 });
      if (parent.organizationKey !== child.organizationKey) {
        throw new ScopeOrganizationMismatchError(parentKey, childKey);
      }

      const existingParentCursor = await database.query(
        'FOR relation IN @@collection FILTER relation.childKey == @childKey LIMIT 1 RETURN relation',
        { '@collection': SCOPE_SCOPES_COLLECTION, childKey },
      );
      if (await existingParentCursor.next()) throw new ScopeAlreadyHasParentError(childKey);

      if (await wouldCreateCycle(parentKey, childKey)) {
        throw new ScopeCycleError(parentKey, childKey);
      }

      try {
        const result = await database.collection(SCOPE_SCOPES_COLLECTION).save(toArangoDoc(relation), { returnNew: true });
        await database.collection(SCOPES_COLLECTION).update(child.key, { level: relation.level });
        const saved = (result as { new?: Record<string, unknown> }).new;
        return (saved ? scopeScopeSchema.parse(withArangoKey(saved)) : relation) satisfies ScopeScope;
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) {
          throw new DuplicateScopeRelationError(parentKey, childKey);
        }
        throw error;
      }
    },

    async removeScopeRelation(parentKey, childKey) {
      const cursor = await database.query(
        'FOR relation IN @@collection FILTER relation.parentKey == @parentKey && relation.childKey == @childKey LIMIT 1 RETURN relation',
        { '@collection': SCOPE_SCOPES_COLLECTION, parentKey, childKey },
      );
      const raw = await cursor.next();
      if (!raw) throw new ScopeRelationNotFoundError(parentKey, childKey);
      const relation = scopeScopeSchema.parse(withArangoKey(raw as Record<string, unknown>));
      await database.collection(SCOPE_SCOPES_COLLECTION).remove(relation.key);
    },

    listChildRelations(parentKey) {
      return listRelations(parentKey);
    },
  };
}

function parseOrganizationKey(value: string): string {
  return scopeSchema.shape.organizationKey.parse(value);
}

let cachedDefaultRepository: ScopeRepository | null = null;

export function getDefaultScopeRepository(): ScopeRepository {
  cachedDefaultRepository ??= createScopeRepository();
  return cachedDefaultRepository;
}
