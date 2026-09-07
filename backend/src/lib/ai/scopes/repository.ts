import { db } from '@/lib/db/client';
import { withDatabaseTransaction } from '@/lib/db/client';
import { buildEmbeddingText, isArangoNotFoundError, isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { embedText, embeddingMetadata } from '@/lib/embeddings';
import { PRODUCT_SCOPE_SLUGS } from '@/lib/apps/registry';
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
  ProductScopeMutationError,
  DuplicateScopeSlugError,
  ScopeAlreadyHasParentError,
  ScopeCycleError,
  ScopeNotFoundError,
  ScopeTeamMismatchError,
  ScopeRelationNotFoundError,
  type ScopeRepository,
  type ScopesDatabase,
} from './types';

export const SCOPE_REMOVAL_WRITE_COLLECTIONS = [
  'users', 'scopes', 'scopeScopes', 'scopeMembers', 'userTeams', 'conversations', 'conversationMessages', 'teamConnectors', 'folders', 'documents', 'documentVersions', 'documentAudioVersions', 'documentSummaries', 'documentSummaryAudio', 'generatedDocumentBindings', 'emailAttachmentBindings', 'emailAttachments', 'emailInboxes', 'emailThreads', 'emailMessages', 'emailDrafts', 'emailTones', 'emailReplyContext', 'emailWritingProfiles', 'images', 'imageCaptions', 'visualIdentities', 'galleryUploads', 'collectionImages', 'imageIdentities', 'imageCollecitionHightlights', 'imageCollectionMemories', 'placeImages', 'collections', 'places', 'trips', 'tripPlaces', 'tripAttachments', 'tripCreationReceipts', 'tripGuides', 'placeReferences', 'placeHeroMedia', 'books', 'bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'chapterContexts', 'bookProgress', 'bookExtensions', 'bookRefundIntents', 'tags', 'tagAssignments', 'userHiddens', 'events', 'contentSearchQueries', 'channels', 'channelParticipants', 'threads', 'messages', 'messageMentions', 'messageReactions', 'polls', 'pollOptions', 'pollVotes', 'storageDeletionJobs', 'ticketVotes', 'tickets',
] as const;

const SCOPE_REMOVAL_SPECIAL_COLLECTIONS = new Set<string>(['users', 'scopes', 'scopeScopes', 'userTeams', 'storageDeletionJobs', 'bookRefundIntents']);
export const SCOPE_KEYED_REMOVAL_COLLECTIONS = SCOPE_REMOVAL_WRITE_COLLECTIONS.filter((collection) => !SCOPE_REMOVAL_SPECIAL_COLLECTIONS.has(collection));

export function createScopeRepository(
  database: ScopesDatabase = db,
  generateEmbedding: (text: string) => Promise<number[]> = async (text) => embedText({ text }),
  options: { allowProductHierarchyMutation?: boolean } = {},
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

  async function requireMutableHierarchyScope(scopeKey: string): Promise<void> {
    if (options.allowProductHierarchyMutation) return;
    const cursor = await database.query(`
      RETURN LENGTH(
        FOR scope IN scopes
          FILTER scope._key == @scopeKey && scope.slug IN @productSlugs
          LET team = DOCUMENT(teams, scope.teamKey)
          FILTER team != null && team.is_root == true
          LIMIT 1
          RETURN 1
      )
    `, { scopeKey, productSlugs: PRODUCT_SCOPE_SLUGS });
    if (await cursor.next() === 1) throw new ProductScopeMutationError(scopeKey);
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
        const { createEmailRepository } = await import('@/lib/email-inbox/repository');
         await createEmailRepository(database as never).initializeTones(created.key);
        return created;
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) {
          throw new DuplicateScopeSlugError(scope.teamKey, scope.slug);
        }
        throw error;
      }
    },

    async updateScope(scopeKey, input) {
      const current = await requireScope(scopeKey);
      if (input.slug !== undefined && input.slug !== current.slug) await requireMutableHierarchyScope(scopeKey);
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

    async listScopes(teamKey) {
      const validTeamKey = parseTeamKey(teamKey);
      const cursor = await database.query(
        `
          FOR scope IN @@collection
            FILTER scope.teamKey == @teamKey
              && REGEX_TEST(scope._key, "^c[^\\\\s-]{8,}$", true)
            SORT scope.name ASC, scope._key ASC
            RETURN scope
        `,
        { '@collection': SCOPES_COLLECTION, teamKey: validTeamKey },
      );
      const docs = await cursor.all();
      return (docs as Record<string, unknown>[]).map((doc) => scopeSchema.parse(withArangoKey(doc)));
    },

    async removeScope(scopeKey, exclusiveOwnerUserKey) {
      if ('collection' in database) await requireScope(scopeKey);
      await requireMutableHierarchyScope(scopeKey);
      const remove = async (executor: Pick<typeof db, 'query'>) => {
        if (!('collection' in database)) {
          const exists = await executor.query<number>('RETURN DOCUMENT(scopes, @scopeKey) == null ? 0 : 1', { scopeKey });
          if (await exists.next() !== 1) throw new ScopeNotFoundError(scopeKey);
        }
        if (exclusiveOwnerUserKey) {
          const shared = await executor.query<number>(`
            LET scope = DOCUMENT(scopes, @scopeKey)
            LET otherTeamMember = LENGTH(FOR membership IN userTeams FILTER scope != null && membership.teamKey == scope.teamKey && membership.status == "active" && membership.userId != @exclusiveOwnerUserKey LIMIT 1 RETURN 1)
            LET otherScopeMember = LENGTH(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.status == "active" LET membership = DOCUMENT(userTeams, member.userTeamKey) FILTER membership != null && membership.status == "active" && membership.userId != @exclusiveOwnerUserKey LIMIT 1 RETURN 1)
            RETURN otherTeamMember + otherScopeMember
          `, { scopeKey, exclusiveOwnerUserKey });
          if ((await shared.next() ?? 0) > 0) throw new Error('A shared scope cannot be deleted.');
        }
        const currentScopeUsers = await executor.query<number>('RETURN LENGTH(FOR user IN users FILTER user.currentScopeKey == @scopeKey && (@exclusiveOwnerUserKey == null || user._key != @exclusiveOwnerUserKey) LIMIT 1 RETURN 1)', { scopeKey, exclusiveOwnerUserKey: exclusiveOwnerUserKey ?? null });
        if ((await currentScopeUsers.next() ?? 0) > 0) throw new Error('A current user scope cannot be deleted.');

        const storage = await executor.query<string[]>(`
          LET storageKeys = UNIQUE(FOR storageKey IN FLATTEN(UNION(
            (FOR document IN documents FILTER document.scopeKey == @scopeKey RETURN UNION(IS_STRING(document.storageKey) ? [document.storageKey] : [], IS_ARRAY(document.sourceStorageKeys) ? document.sourceStorageKeys : [], IS_ARRAY(document.speechStorageKeys) ? document.speechStorageKeys : [])),
            (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && IS_STRING(version.storageKey) RETURN version.storageKey),
            (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && IS_STRING(audio.storageKey) RETURN audio.storageKey),
            (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && IS_STRING(audio.storageKey) RETURN audio.storageKey),
            (FOR book IN books FILTER book.scopeKey == @scopeKey && IS_STRING(book.coverStorageKey) RETURN book.coverStorageKey),
            (FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && IS_STRING(chapter.audioStorageKey) RETURN chapter.audioStorageKey),
            (FOR attachment IN emailAttachments FILTER attachment.scopeKey == @scopeKey && IS_STRING(attachment.storageKey) RETURN attachment.storageKey),
            (FOR media IN placeHeroMedia FILTER media.scopeKey == @scopeKey && IS_STRING(media.storageKey) RETURN media.storageKey),
            (FOR upload IN galleryUploads FILTER upload.scopeKey == @scopeKey && IS_STRING(upload.storageKey) RETURN upload.storageKey),
            (FOR image IN images FILTER image.scopeKey == @scopeKey && IS_STRING(image.storageKey) RETURN image.storageKey)
          ), 2) FILTER IS_STRING(storageKey) RETURN storageKey)
          RETURN storageKeys
        `, { scopeKey });
        const storageKeys = await storage.next() ?? [];
        if (storageKeys.length) await executor.query('FOR storageKey IN @storageKeys UPSERT { storageKey } INSERT { storageKey, createdAt: @now, status: "pending" } UPDATE {} IN storageDeletionJobs', { storageKeys, scopeKey, now: new Date().toISOString() });

        await executor.query('FOR intent IN bookRefundIntents FILTER intent.bookKey IN (FOR book IN books FILTER book.scopeKey == @scopeKey RETURN book._key) REMOVE intent IN bookRefundIntents', { scopeKey });
        for (const collection of SCOPE_KEYED_REMOVAL_COLLECTIONS) {
          await executor.query('FOR item IN @@collection FILTER item.scopeKey == @scopeKey REMOVE item IN @@collection', { '@collection': collection, scopeKey });
        }
        await executor.query('FOR relation IN scopeScopes FILTER relation.parentKey == @scopeKey || relation.childKey == @scopeKey REMOVE relation IN scopeScopes', { scopeKey });
        const removed = await executor.query('FOR scope IN scopes FILTER scope._key == @scopeKey REMOVE scope IN scopes RETURN OLD._key', { scopeKey });
        if (await removed.next() !== scopeKey) throw new Error('Scope contents changed during deletion; retry the operation');
      };
      if (!database.beginTransaction) return remove(database as unknown as Pick<typeof db, 'query'>);
      await withDatabaseTransaction(database as typeof db, { write: [...SCOPE_REMOVAL_WRITE_COLLECTIONS] }, (executor) => remove(executor));
    },

    async addScopeRelation(parentKey, childKey) {
      const [parent, child] = await Promise.all([requireScope(parentKey), requireScope(childKey)]);
      await requireMutableHierarchyScope(childKey);
      const relation = scopeScopeSchema.parse({ key: newId(), parentKey, childKey, level: parent.level + 1 });
      if (parent.teamKey !== child.teamKey) {
        throw new ScopeTeamMismatchError(parentKey, childKey);
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
      await requireMutableHierarchyScope(childKey);
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

function parseTeamKey(value: string): string {
  return scopeSchema.shape.teamKey.parse(value);
}

let cachedDefaultRepository: ScopeRepository | null = null;

export function getDefaultScopeRepository(): ScopeRepository {
  cachedDefaultRepository ??= createScopeRepository();
  return cachedDefaultRepository;
}
