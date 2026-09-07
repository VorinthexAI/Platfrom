import { documentSchema, type Document } from "./documents.node";
import { folderSchema, type Folder } from "./folders.node";
import {
  documentVersionSchema,
  type DocumentVersion,
} from "./document-versions.node";
import {
  documentAudioVersionSchema,
  type DocumentAudioVersion,
} from "./document-audio-versions.node";
import {
  documentSummarySchema,
  type DocumentSummary,
} from "./document-summaries.node";
import {
  documentSummaryAudioSchema,
  type DocumentSummaryAudio,
} from "./document-summary-audio.node";
import { newId } from "@/lib/ids";
import { toArangoDoc, withArangoKey } from "./base";
import { db, withTransaction } from "./client";
import {
  currentEmbeddingBatchSchema,
  currentEmbeddingSchema,
} from "@/lib/embeddings";
import {
  chunkDocumentContent,
  documentSemanticHash,
} from "@/lib/ai/document-processing/chunking";
import { z } from "zod";

type QueryCursor = { next(): Promise<unknown>; all?(): Promise<unknown[]> };
export interface ContentQueryExecutor {
  query(
    query: string,
    bindVars?: Record<string, unknown>,
  ): Promise<QueryCursor>;
}

type ContentRole = "viewer" | "moderator" | "admin" | "owner";
const contentRoleRank: Record<ContentRole, number> = {
  viewer: 1,
  moderator: 2,
  admin: 3,
  owner: 4,
};

type MutableFolderField =
  | "parentFolderKey"
  | "name"
  | "description"
  | "coverImageKey"
  | "isFavorite"
  | "updatedAt"
  | "embedding"
  | "_internalDeletion";
type MutableDocumentField =
  | "folderKey"
  | "name"
  | "content"
  | "embedding"
  | "contentChunks"
  | "chunkEmbeddings"
  | "semanticChunkCount"
  | "semanticContentHash"
  | "emailToneEmbeddingVersion"
  | "_semanticChunkingSkipped"
  | "speechStorageKeys"
  | "isFavorite"
  | "updatedAt"
  | "_internalDeletion";
export type ScopedFolderPatch = Partial<Pick<Folder, MutableFolderField>>;
export type ScopedDocumentPatch = Partial<Pick<Document, MutableDocumentField>>;

function splitPatch(patch: Record<string, unknown>) {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) unset.push(field);
    else set[field] = value;
  }
  return { set, unset };
}

async function scopedUpdate<T>(
  executor: ContentQueryExecutor,
  collection: "folders" | "documents" | "documentVersions",
  scopeKey: string,
  key: string,
  patch: Record<string, unknown>,
  parse: (value: Record<string, unknown>) => T,
  expectedUpdatedAt?: string,
): Promise<T | null> {
  const { set, unset } = splitPatch(patch);
  const ownership =
    collection === "folders"
      ? `
      FILTER !HAS(current, "_internalDeletion") || current._internalDeletion == null
      FILTER (current.mutationPolicy != "system-container" && current.managedPurpose == null) || @allowManagedUpdate
      LET destinationKey = @changesLocation ? @destinationKey : (HAS(current, "parentFolderKey") ? current.parentFolderKey : null)
      LET destination = destinationKey == null ? null : DOCUMENT(folders, destinationKey)
      FILTER destinationKey == null || (destination != null && destination.scopeKey == @scopeKey)
      FILTER destinationKey == null || (!HAS(destination, "_internalDeletion") || destination._internalDeletion == null)
       FILTER !@changesLocation || destinationKey == null || destinationKey == current.parentFolderKey || (destination.mutationPolicy != "system-container" && destination.managedPurpose == null)
  `
      : collection === "documents"
        ? `
      FILTER !HAS(current, "_internalDeletion") || current._internalDeletion == null
       FILTER (current.mutationPolicy != "system-only" && current.managedPurpose == null) || @allowManagedUpdate
      LET destinationKey = @changesLocation ? @destinationKey : (HAS(current, "folderKey") ? current.folderKey : null)
      LET destination = destinationKey == null ? null : DOCUMENT(folders, destinationKey)
      FILTER destinationKey == null || (destination != null && destination.scopeKey == @scopeKey)
      FILTER destinationKey == null || (!HAS(destination, "_internalDeletion") || destination._internalDeletion == null)
       FILTER !@changesLocation || destinationKey == null || destinationKey == current.folderKey || (destination.mutationPolicy != "system-container" && destination.managedPurpose == null)
  `
        : collection === "documentVersions"
          ? `
      LET owner = DOCUMENT(documents, current.documentKey)
       FILTER owner != null && owner.scopeKey == @scopeKey
       FILTER !HAS(owner, "_internalDeletion") || owner._internalDeletion == null
       FILTER owner.mutationPolicy != "system-only" && owner.managedPurpose == null
  `
          : ``;
  const cursor = await executor.query(
    `
    FOR current IN @@collection
      FILTER current._key == @key && current.scopeKey == @scopeKey
      FILTER @expectedUpdatedAt == null || current.updatedAt == @expectedUpdatedAt
      ${ownership}
      LIMIT 1
      REPLACE current WITH UNSET(MERGE(current, @patch), APPEND(@unset, ["_id", "_rev"]))
        IN @@collection
      RETURN NEW
  `,
    {
      "@collection": collection,
      key,
      scopeKey,
      ...(collection === "documentVersions"
        ? {}
        : { destinationKey: set.parentFolderKey ?? set.folderKey ?? null }),
      ...(collection === "folders"
        ? {
            changesLocation: Object.prototype.hasOwnProperty.call(
              patch,
              "parentFolderKey",
            ),
          }
        : {}),
      ...(collection === "documents"
        ? {
            changesLocation: Object.prototype.hasOwnProperty.call(
              patch,
              "folderKey",
            ),
          }
        : {}),
      ...(collection === "folders" || collection === "documents"
        ? {
            allowManagedUpdate: Object.keys(patch).every(
              (field) => field === "isFavorite" || field === "updatedAt",
            ),
          }
        : {}),
      patch: set,
      unset,
      expectedUpdatedAt: expectedUpdatedAt ?? null,
    },
  );
  const value = await cursor.next();
  return value ? parse(withArangoKey(value as Record<string, unknown>)) : null;
}

async function scopedDelete(
  executor: ContentQueryExecutor,
  collection:
    | "folders"
    | "documents"
    | "documentVersions"
    | "documentAudioVersions"
    | "documentSummaries"
    | "documentSummaryAudio",
  scopeKey: string,
  key: string,
  protectSystemContainer = false,
): Promise<boolean> {
  const hiddenSource =
    collection === "folders"
      ? "folder"
      : collection === "documents"
        ? "document"
        : null;
  const attachmentType = collection === "folders" ? "folder" : null;
  const now = new Date().toISOString();
  const cursor = await executor.query(
    `
    LET affectedTripKeys = @attachmentType == null ? [] : (FOR attachment IN tripAttachments FILTER attachment.scopeKey == @scopeKey && attachment.targetType == @attachmentType && attachment.targetKey == @key RETURN DISTINCT attachment.tripKey)
    LET removedKey = FIRST(FOR current IN @@collection
        FILTER current._key == @key && current.scopeKey == @scopeKey
        FILTER (!@protectSystemContainer || current.mutationPolicy != "system-container") && current.mutationPolicy != "system-only" && current.managedPurpose == null
        LIMIT 1
        REMOVE current IN @@collection
        RETURN OLD._key)
    LET cleanupAttachments = (FOR attachment IN tripAttachments
      FILTER @attachmentType != null && attachment.scopeKey == @scopeKey
        && attachment.targetType == @attachmentType && attachment.targetKey == removedKey
      REMOVE attachment IN tripAttachments RETURN 1)
    LET touchTrips = (FOR trip IN trips FILTER trip.scopeKey == @scopeKey && trip._key IN affectedTripKeys UPDATE trip WITH { updatedAt: @now } IN trips RETURN 1)
    RETURN removedKey
  `,
    {
      "@collection": collection,
      key,
      scopeKey,
      attachmentType,
      protectSystemContainer,
      now,
    },
  );
  const removedKey = await cursor.next();
  if (typeof removedKey !== "string") return false;
  if (hiddenSource) {
    await executor.query(
      "FOR hidden IN userHiddens FILTER hidden.source == @hiddenSource && hidden.sourceKey == @removedKey REMOVE hidden IN userHiddens",
      { hiddenSource, removedKey },
    );
  }
  if (collection === "documents" || collection === "folders") {
    await executor.query(
      "FOR assignment IN tagAssignments FILTER assignment.scopeKey == @scopeKey && assignment.sourceType == @sourceType && assignment.sourceKey == @removedKey REMOVE assignment IN tagAssignments",
      {
        scopeKey,
        sourceType: collection === "documents" ? "document" : "folder",
        removedKey,
      },
    );
  }
  return true;
}

/** Query-bound mutations can use either the global database or a streaming transaction executor. */
export function createContentPersistence(executor: ContentQueryExecutor) {
  return {
    async getScope(
      scopeKey: string,
    ): Promise<{ key: string; teamKey: string } | null> {
      const cursor = await executor.query(
        "LET scope = DOCUMENT(scopes, @scopeKey) RETURN scope == null ? null : { key: scope._key, teamKey: scope.teamKey }",
        { scopeKey },
      );
      const value = (await cursor.next()) as
        { key?: unknown; teamKey?: unknown } | null | undefined;
      if (!value) return null;
      return z
        .object({ key: z.string(), teamKey: z.string() })
        .parse(value);
    },
    async role(
      scopeKey: string,
      teamMembershipKey: string,
    ): Promise<ContentRole | null> {
      const cursor = await executor.query(
        'RETURN { members: (FOR member IN scopeMembers FILTER member.userTeamKey == @teamMembershipKey && member.status == "active" RETURN { scopeKey: member.scopeKey, role: member.role }), relations: (FOR relation IN scopeScopes RETURN { parentKey: relation.parentKey, childKey: relation.childKey }) }',
        { teamMembershipKey },
      );
      const data = (await cursor.next()) as
        | {
            members?: Array<{ scopeKey: string; role: ContentRole }>;
            relations?: Array<{ parentKey: string; childKey: string }>;
          }
        | undefined;
      const parentByChild = new Map(
        (data?.relations ?? []).map((relation) => [
          relation.childKey,
          relation.parentKey,
        ]),
      );
      const ancestors = new Set([scopeKey]);
      let current = parentByChild.get(scopeKey);
      while (current && !ancestors.has(current)) {
        ancestors.add(current);
        current = parentByChild.get(current);
      }
      return (
        (data?.members ?? [])
          .filter((item) => ancestors.has(item.scopeKey))
          .sort((a, b) => contentRoleRank[b.role] - contentRoleRank[a.role])[0]
          ?.role ?? null
      );
    },
    async scopeBelongsToActiveTeam(
      scopeKey: string,
      teamKey: string,
    ): Promise<boolean> {
      const cursor = await executor.query(
        "LET scope = DOCUMENT(scopes, @scopeKey) RETURN scope != null && scope.teamKey == @teamKey",
        { scopeKey, teamKey },
      );
      return (await cursor.next()) === true;
    },
    async getFolder(key: string): Promise<Folder | null> {
      const cursor = await executor.query("RETURN DOCUMENT(folders, @key)", {
        key,
      });
      const value = await cursor.next();
      return value
        ? folderSchema.parse(withArangoKey(value as Record<string, unknown>))
        : null;
    },
    async listFolders(
      scopeKey: string,
      includePendingDeletion = false,
    ): Promise<Folder[]> {
      const cursor = await executor.query(
        `FOR folder IN folders FILTER folder.scopeKey == @scopeKey FILTER @includePending || !HAS(folder, "_internalDeletion") || folder._internalDeletion == null RETURN folder`,
        { scopeKey, includePending: includePendingDeletion },
      );
      const values = cursor.all ? await cursor.all() : [];
      return values.map((value) =>
        folderSchema.parse(withArangoKey(value as Record<string, unknown>)),
      );
    },
    async getDocument(key: string): Promise<Document | null> {
      const cursor = await executor.query("RETURN DOCUMENT(documents, @key)", {
        key,
      });
      const value = await cursor.next();
      return value
        ? documentSchema.parse(withArangoKey(value as Record<string, unknown>))
        : null;
    },
    async listDocuments(
      scopeKey: string,
      includePendingDeletion = false,
    ): Promise<Document[]> {
      const cursor = await executor.query(
        `FOR document IN documents FILTER document.scopeKey == @scopeKey FILTER @includePending || !HAS(document, "_internalDeletion") || document._internalDeletion == null RETURN document`,
        { scopeKey, includePending: includePendingDeletion },
      );
      const values = cursor.all ? await cursor.all() : [];
      return values.map((value) =>
        documentSchema.parse(withArangoKey(value as Record<string, unknown>)),
      );
    },
    async semanticNeighbors(input: {
      embedding: number[];
      scopeKey: string;
      activeFolderKeys: string[];
      sourceFolderKey?: string;
      sourceDocumentKey?: string;
      limit: number;
    }) {
      const embedding = currentEmbeddingSchema.parse(input.embedding);
      const limit = Math.min(
        Math.max(z.number().int().positive().parse(input.limit), 1),
        10,
      );
      const cursor = await executor.query(
        `
        LET folderMatches = (FOR folder IN folders
          FILTER folder.scopeKey == @scopeKey
          FILTER (!HAS(folder, "_internalDeletion") || folder._internalDeletion == null) && folder._key IN @activeFolderKeys
          FILTER @sourceFolderKey == null || folder._key != @sourceFolderKey
          FILTER IS_ARRAY(folder.embedding) && LENGTH(folder.embedding) == LENGTH(@embedding)
          LET score = COSINE_SIMILARITY(folder.embedding, @embedding)
          FILTER IS_NUMBER(score)
          SORT score DESC, folder._key ASC
          LIMIT @limit
          RETURN { score, value: folder })
        LET documentMatches = (FOR document IN documents
          FILTER document.scopeKey == @scopeKey
          FILTER (document.archiveVisibility || "visible") == "visible"
          FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
          FILTER document.folderKey == null || document.folderKey IN @activeFolderKeys
          FILTER @sourceDocumentKey == null || document._key != @sourceDocumentKey
          FILTER !HAS(document, "extension") || document.extension == null
          LET scores = (FOR vector IN (IS_ARRAY(document.chunkEmbeddings) && LENGTH(document.chunkEmbeddings) > 0 ? document.chunkEmbeddings : [document.embedding])
            FILTER IS_ARRAY(vector) && LENGTH(vector) == LENGTH(@embedding)
            LET score = COSINE_SIMILARITY(vector, @embedding)
            FILTER IS_NUMBER(score)
            RETURN score)
          FILTER LENGTH(scores) > 0
          LET score = MAX(scores)
          SORT score DESC, document._key ASC
          LIMIT @limit
          RETURN { score, value: document })
        LET fileMatches = (FOR document IN documents
          FILTER document.scopeKey == @scopeKey
          FILTER (document.archiveVisibility || "visible") == "visible"
          FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
          FILTER document.folderKey == null || document.folderKey IN @activeFolderKeys
          FILTER @sourceDocumentKey == null || document._key != @sourceDocumentKey
          FILTER HAS(document, "extension") && document.extension != null
          LET scores = (FOR vector IN (IS_ARRAY(document.chunkEmbeddings) && LENGTH(document.chunkEmbeddings) > 0 ? document.chunkEmbeddings : [document.embedding])
            FILTER IS_ARRAY(vector) && LENGTH(vector) == LENGTH(@embedding)
            LET score = COSINE_SIMILARITY(vector, @embedding)
            FILTER IS_NUMBER(score)
            RETURN score)
          FILTER LENGTH(scores) > 0
          LET score = MAX(scores)
          SORT score DESC, document._key ASC
          LIMIT @limit
          RETURN { score, value: document })
        RETURN { folders: folderMatches, documents: documentMatches, files: fileMatches }
      `,
        {
          ...input,
          embedding,
          limit,
          sourceFolderKey: input.sourceFolderKey ?? null,
          sourceDocumentKey: input.sourceDocumentKey ?? null,
        },
      );
      const result = (await cursor.next()) as
        | {
            folders?: Array<{ score: number; value: Record<string, unknown> }>;
            documents?: Array<{
              score: number;
              value: Record<string, unknown>;
            }>;
            files?: Array<{ score: number; value: Record<string, unknown> }>;
          }
        | undefined;
      return {
        folders: (result?.folders ?? []).map(({ score, value }) => ({
          score,
          folder: folderSchema.parse(withArangoKey(value)),
        })),
        documents: (result?.documents ?? []).map(({ score, value }) => ({
          score,
          document: documentSchema.parse(withArangoKey(value)),
        })),
        files: (result?.files ?? []).map(({ score, value }) => ({
          score,
          document: documentSchema.parse(withArangoKey(value)),
        })),
      };
    },
    async getVersion(key: string): Promise<DocumentVersion | null> {
      const cursor = await executor.query(
        "RETURN DOCUMENT(documentVersions, @key)",
        { key },
      );
      const value = await cursor.next();
      return value
        ? documentVersionSchema.parse(
            withArangoKey(value as Record<string, unknown>),
          )
        : null;
    },
    async listVersions(
      scopeKey: string,
      documentKeys: string[],
    ): Promise<DocumentVersion[]> {
      if (documentKeys.length === 0) return [];
      const cursor = await executor.query(
        "FOR snapshot IN documentVersions FILTER snapshot.scopeKey == @scopeKey && snapshot.documentKey IN @documentKeys SORT snapshot.version DESC RETURN snapshot",
        { scopeKey, documentKeys },
      );
      const values = cursor.all ? await cursor.all() : [];
      return values.map((value) =>
        documentVersionSchema.parse(
          withArangoKey(value as Record<string, unknown>),
        ),
      );
    },
    async getAudioVersion(key: string): Promise<DocumentAudioVersion | null> {
      const cursor = await executor.query(
        "RETURN DOCUMENT(documentAudioVersions, @key)",
        { key },
      );
      const value = await cursor.next();
      return value
        ? documentAudioVersionSchema.parse(
            withArangoKey(value as Record<string, unknown>),
          )
        : null;
    },
    async listAudioVersions(
      scopeKey: string,
      documentKeys: string[],
    ): Promise<DocumentAudioVersion[]> {
      if (documentKeys.length === 0) return [];
      const cursor = await executor.query(
        "FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey IN @documentKeys SORT audio.version DESC RETURN audio",
        { scopeKey, documentKeys },
      );
      const values = cursor.all ? await cursor.all() : [];
      return values.map((value) =>
        documentAudioVersionSchema.parse(
          withArangoKey(value as Record<string, unknown>),
        ),
      );
    },
    async updateAudioPlayback(
      scopeKey: string,
      key: string,
      playbackPositionMs: number,
    ): Promise<DocumentAudioVersion | null> {
      playbackPositionMs = z
        .number()
        .int()
        .nonnegative()
        .parse(playbackPositionMs);
      const cursor = await executor.query(
        `
        LET target = DOCUMENT(documentAudioVersions, @key)
        FILTER target != null && target.scopeKey == @scopeKey && @playbackPositionMs <= target.durationMs
        LET document = DOCUMENT(documents, target.documentKey)
        FILTER document != null && document.scopeKey == @scopeKey
        FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
        FILTER document.mutationPolicy != "system-only" && document.managedPurpose == null
        FOR audio IN documentAudioVersions
          FILTER audio.scopeKey == @scopeKey && audio.documentKey == target.documentKey
          FILTER audio._key == target._key || audio.isCurrent == true
          UPDATE audio WITH MERGE(
            { isCurrent: audio._key == target._key },
            audio._key == target._key ? { playbackPositionMs: @playbackPositionMs } : {}
          ) IN documentAudioVersions
          LET updated = NEW
          FILTER updated._key == target._key
          RETURN updated
      `,
        { key, scopeKey, playbackPositionMs },
      );
      const updated = await cursor.next();
      return updated
        ? documentAudioVersionSchema.parse(
            withArangoKey(updated as Record<string, unknown>),
          )
        : null;
    },
    async clearCurrentAudioVersion(
      scopeKey: string,
      documentKey: string,
    ): Promise<boolean> {
      const cursor = await executor.query(
        `
        LET document = DOCUMENT(documents, @documentKey)
        FILTER document != null && document.scopeKey == @scopeKey
        FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
        FILTER document.mutationPolicy != "system-only" && document.managedPurpose == null
        FOR audio IN documentAudioVersions
          FILTER audio.scopeKey == @scopeKey && audio.documentKey == @documentKey && audio.isCurrent == true
          UPDATE audio WITH { isCurrent: false } IN documentAudioVersions
          COLLECT WITH COUNT INTO cleared
          RETURN cleared
      `,
        { documentKey, scopeKey },
      );
      return Number((await cursor.next()) ?? 0) > 0;
    },
    async getSummary(key: string): Promise<DocumentSummary | null> {
      const cursor = await executor.query(
        "RETURN DOCUMENT(documentSummaries, @key)",
        { key },
      );
      const value = await cursor.next();
      return value
        ? documentSummarySchema.parse(
            withArangoKey(value as Record<string, unknown>),
          )
        : null;
    },
    async listSummaries(
      scopeKey: string,
      documentKeys: string[],
    ): Promise<DocumentSummary[]> {
      if (documentKeys.length === 0) return [];
      const cursor = await executor.query(
        "FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey IN @documentKeys SORT summary.version DESC RETURN summary",
        { scopeKey, documentKeys },
      );
      const values = cursor.all ? await cursor.all() : [];
      return values.map((value) =>
        documentSummarySchema.parse(
          withArangoKey(value as Record<string, unknown>),
        ),
      );
    },
    async getSummaryAudio(
      summaryKey: string,
    ): Promise<DocumentSummaryAudio | null> {
      const cursor = await executor.query(
        "FOR audio IN documentSummaryAudio FILTER audio.summaryKey == @summaryKey LIMIT 1 RETURN audio",
        { summaryKey },
      );
      const value = await cursor.next();
      return value
        ? documentSummaryAudioSchema.parse(
            withArangoKey(value as Record<string, unknown>),
          )
        : null;
    },
    async listSummaryAudio(
      scopeKey: string,
      summaryKeys: string[],
    ): Promise<DocumentSummaryAudio[]> {
      if (summaryKeys.length === 0) return [];
      const cursor = await executor.query(
        "FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && audio.summaryKey IN @summaryKeys RETURN audio",
        { scopeKey, summaryKeys },
      );
      const values = cursor.all ? await cursor.all() : [];
      return values.map((value) =>
        documentSummaryAudioSchema.parse(
          withArangoKey(value as Record<string, unknown>),
        ),
      );
    },
    async insertFolder(folder: Folder): Promise<Folder> {
      const parsed = folderSchema.parse(folder);
      if (parsed.embedding.length)
        currentEmbeddingSchema.parse(parsed.embedding);
      const cursor = await executor.query(
        `LET parent = @parentKey == null ? {} : DOCUMENT(folders, @parentKey)
         FILTER @parentKey == null || (parent != null && parent.scopeKey == @scopeKey && (!HAS(parent, "_internalDeletion") || parent._internalDeletion == null) && parent.mutationPolicy != "system-container" && parent.managedPurpose == null)
         INSERT @folder INTO folders RETURN NEW`,
        {
          folder: toArangoDoc(parsed),
          parentKey: parsed.parentFolderKey ?? null,
          scopeKey: parsed.scopeKey,
        },
      );
      const created = await cursor.next();
      if (!created) throw new Error("Folder destination is pending deletion.");
      return folderSchema.parse(
        withArangoKey(created as Record<string, unknown>),
      );
    },
    async insertDocument(document: Document): Promise<Document> {
      currentEmbeddingSchema.parse(document.embedding);
      const expectedChunks = chunkDocumentContent(document.content);
      if (
        document.contentChunks &&
        (document.contentChunks.length !== expectedChunks.length ||
          document.contentChunks.some(
            (chunk, index) => chunk !== expectedChunks[index],
          ))
      )
        throw new Error(
          "Document chunks must be derived from canonical content.",
        );
      const contentChunks = document.contentChunks ?? expectedChunks;
      const chunkEmbeddings =
        document.chunkEmbeddings ??
        (contentChunks.length === 1 ? [document.embedding] : undefined);
      if (!chunkEmbeddings || contentChunks.length !== chunkEmbeddings.length)
        throw new Error(
          "Documents require aligned semantic chunks and embeddings.",
        );
      currentEmbeddingBatchSchema.parse(chunkEmbeddings);
      const parsed = documentSchema.parse({
        ...document,
        contentChunks,
        chunkEmbeddings,
        semanticChunkCount: contentChunks.length,
        semanticContentHash: documentSemanticHash(document.content),
        _semanticChunkingSkipped: undefined,
      });
      const cursor = await executor.query(
        `LET folder = @folderKey == null ? null : DOCUMENT(folders, @folderKey)
         FILTER @folderKey == null || (folder != null && folder.scopeKey == @scopeKey)
         FILTER @folderKey == null || (!HAS(folder, "_internalDeletion") || folder._internalDeletion == null)
         FILTER @folderKey == null || (folder.mutationPolicy != "system-container" && folder.managedPurpose == null)
         INSERT @document INTO documents RETURN NEW`,
        {
          document: toArangoDoc(parsed),
          folderKey: parsed.folderKey ?? null,
          scopeKey: parsed.scopeKey,
        },
      );
      const created = await cursor.next();
      if (!created)
        throw new Error("Document destination is pending deletion.");
      return documentSchema.parse(
        withArangoKey(created as Record<string, unknown>),
      );
    },
    async createVersion(
      version: Omit<DocumentVersion, "key" | "version" | "createdAt">,
    ): Promise<DocumentVersion> {
      currentEmbeddingSchema.parse(version.embedding);
      const contentChunks = chunkDocumentContent(version.content);
      const chunkEmbeddings =
        version.chunkEmbeddings ??
        (contentChunks.length === 1 ? [version.embedding] : undefined);
      if (!chunkEmbeddings || contentChunks.length !== chunkEmbeddings.length)
        throw new Error("Document versions require aligned chunk embeddings.");
      currentEmbeddingBatchSchema.parse(chunkEmbeddings);
      const snapshot = documentVersionSchema.omit({ version: true }).parse({
        ...version,
        chunkEmbeddings,
        semanticChunkCount: contentChunks.length,
        semanticContentHash: documentSemanticHash(version.content),
        _semanticChunkingSkipped: undefined,
        key: newId(),
        createdAt: new Date().toISOString(),
      });
      const cursor = await executor.query(
        `
        LET document = DOCUMENT(documents, @documentKey)
        FILTER document != null && document.scopeKey == @scopeKey
        FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
        FILTER document.mutationPolicy != "system-only" && document.managedPurpose == null
         LET folder = HAS(document, "folderKey") && document.folderKey != null ? DOCUMENT(folders, document.folderKey) : null
         FILTER folder == null || folder.scopeKey == @scopeKey
         FILTER folder == null || !HAS(folder, "_internalDeletion") || folder._internalDeletion == null
        LET nextVersion = FIRST(
          FOR existing IN documentVersions
            FILTER existing.documentKey == @documentKey
            COLLECT AGGREGATE maximum = MAX(existing.version)
            RETURN (maximum || 0) + 1
        )
        INSERT MERGE(@snapshot, { version: nextVersion }) INTO documentVersions
        RETURN NEW
      `,
        {
          documentKey: version.documentKey,
          scopeKey: version.scopeKey,
          snapshot: toArangoDoc(snapshot),
        },
      );
      const created = await cursor.next();
      if (!created) throw new Error("Version owner is pending deletion.");
      return documentVersionSchema.parse(
        withArangoKey(created as Record<string, unknown>),
      );
    },
    async createAudioVersion(
      input: Omit<
        DocumentAudioVersion,
        "version" | "isCurrent" | "playbackPositionMs"
      > &
        Partial<Pick<DocumentAudioVersion, "isCurrent" | "playbackPositionMs">>,
    ): Promise<DocumentAudioVersion> {
      const audio = documentAudioVersionSchema
        .omit({ version: true })
        .parse(input);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          const cursor = await executor.query(
            `
            LET document = DOCUMENT(documents, @documentKey)
            FILTER document != null && document.scopeKey == @scopeKey
            FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
            FILTER document.mutationPolicy != "system-only" && document.managedPurpose == null
            LET nextVersion = FIRST(
              FOR existing IN documentAudioVersions
                FILTER existing.documentKey == @documentKey
                COLLECT AGGREGATE maximum = MAX(existing.version)
                RETURN (maximum || 0) + 1
            )
            INSERT MERGE(@audio, { version: nextVersion }) INTO documentAudioVersions
            RETURN NEW
          `,
            {
              documentKey: audio.documentKey,
              scopeKey: audio.scopeKey,
              audio: toArangoDoc(audio),
            },
          );
          const created = await cursor.next();
          if (!created)
            throw new Error("Audio version owner is pending deletion.");
          return documentAudioVersionSchema.parse(
            withArangoKey(created as Record<string, unknown>),
          );
        } catch (error) {
          if (
            (error as { errorNum?: number }).errorNum !== 1210 ||
            attempt === 9
          )
            throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, (attempt + 1) * 5),
          );
        }
      }
      throw new Error("Audio version allocation failed.");
    },
    async createSummary(
      input: Omit<DocumentSummary, "version">,
    ): Promise<DocumentSummary> {
      const summary = documentSummarySchema
        .omit({ version: true })
        .parse(input);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          const cursor = await executor.query(
            `
            LET document = DOCUMENT(documents, @documentKey)
            FILTER document != null && document.scopeKey == @scopeKey
            FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
            FILTER document.mutationPolicy != "system-only" && document.managedPurpose == null
            LET nextVersion = FIRST(
              FOR existing IN documentSummaries
                FILTER existing.documentKey == @documentKey
                COLLECT AGGREGATE maximum = MAX(existing.version)
                RETURN (maximum || 0) + 1
            )
            INSERT MERGE(@summary, { version: nextVersion }) INTO documentSummaries
            RETURN NEW
          `,
            {
              documentKey: summary.documentKey,
              scopeKey: summary.scopeKey,
              summary: toArangoDoc(summary),
            },
          );
          const created = await cursor.next();
          if (!created) throw new Error("Summary owner is pending deletion.");
          return documentSummarySchema.parse(
            withArangoKey(created as Record<string, unknown>),
          );
        } catch (error) {
          if (
            (error as { errorNum?: number }).errorNum !== 1210 ||
            attempt === 9
          )
            throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, (attempt + 1) * 5),
          );
        }
      }
      throw new Error("Summary version allocation failed.");
    },
    async createSummaryAudio(
      input: DocumentSummaryAudio,
    ): Promise<{ audio: DocumentSummaryAudio; created: boolean }> {
      const audio = documentSummaryAudioSchema.parse(input);
      try {
        const cursor = await executor.query(
          `
          LET summary = DOCUMENT(documentSummaries, @summaryKey)
          LET document = summary == null ? null : DOCUMENT(documents, summary.documentKey)
          FILTER summary != null && summary.scopeKey == @scopeKey && summary.documentKey == @documentKey
          FILTER document != null && document.scopeKey == @scopeKey
          FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
          FILTER document.mutationPolicy != "system-only" && document.managedPurpose == null
          INSERT @audio INTO documentSummaryAudio RETURN NEW
        `,
          {
            summaryKey: audio.summaryKey,
            documentKey: audio.documentKey,
            scopeKey: audio.scopeKey,
            audio: toArangoDoc(audio),
          },
        );
        const created = await cursor.next();
        if (!created)
          throw new Error("Summary audio owner is pending deletion.");
        return {
          audio: documentSummaryAudioSchema.parse(
            withArangoKey(created as Record<string, unknown>),
          ),
          created: true,
        };
      } catch (error) {
        if ((error as { errorNum?: number }).errorNum !== 1210) throw error;
        const cursor = await executor.query(
          "FOR winner IN documentSummaryAudio FILTER winner.summaryKey == @summaryKey LIMIT 1 RETURN winner",
          { summaryKey: audio.summaryKey },
        );
        const value = await cursor.next();
        const winner = value
          ? documentSummaryAudioSchema.parse(
              withArangoKey(value as Record<string, unknown>),
            )
          : null;
        if (!winner) throw error;
        return { audio: winner, created: false };
      }
    },
    updateFolder(scopeKey: string, key: string, patch: ScopedFolderPatch) {
      if (
        ("name" in patch || "description" in patch) &&
        patch.embedding === undefined
      )
        throw new Error("Folder semantic updates require a fresh embedding.");
      if (patch.embedding !== undefined && patch.embedding.length)
        currentEmbeddingSchema.parse(patch.embedding);
      return scopedUpdate(executor, "folders", scopeKey, key, patch, (value) =>
        folderSchema.parse(value),
      );
    },
    updateDocument(
      scopeKey: string,
      key: string,
      patch: ScopedDocumentPatch,
      options?: { expectedUpdatedAt?: string },
    ) {
      if (patch.content !== undefined && patch.embedding === undefined)
        throw new Error("Document content updates require a fresh embedding.");
      const contentChunks =
        patch.content !== undefined
          ? (patch.contentChunks ?? chunkDocumentContent(patch.content))
          : patch.contentChunks;
      if (patch.content !== undefined && patch.contentChunks) {
        const expectedChunks = chunkDocumentContent(patch.content!);
        if (
          patch.contentChunks.length !== expectedChunks.length ||
          patch.contentChunks.some(
            (chunk, index) => chunk !== expectedChunks[index],
          )
        )
          throw new Error(
            "Document chunks must be derived from canonical content.",
          );
      }
      const chunkEmbeddings =
        patch.content !== undefined
          ? (patch.chunkEmbeddings ??
            (contentChunks?.length === 1 ? [patch.embedding!] : undefined))
          : patch.chunkEmbeddings;
      if (
        patch.content !== undefined &&
        (!contentChunks ||
          !chunkEmbeddings ||
          contentChunks.length !== chunkEmbeddings.length)
      )
        throw new Error(
          "Document content updates require aligned semantic chunks and embeddings.",
        );
      if (patch.embedding !== undefined)
        currentEmbeddingSchema.parse(patch.embedding);
      if (chunkEmbeddings !== undefined)
        currentEmbeddingBatchSchema.parse(chunkEmbeddings);
      const semanticPatch =
        patch.content === undefined
          ? patch
          : {
              ...patch,
              contentChunks,
              chunkEmbeddings,
              semanticChunkCount: contentChunks!.length,
              semanticContentHash: documentSemanticHash(patch.content),
              _semanticChunkingSkipped: undefined,
            };
      const preparedPatch =
        patch.content !== undefined || patch.name !== undefined
          ? { ...semanticPatch, emailToneEmbeddingVersion: undefined }
          : semanticPatch;
      return scopedUpdate(
        executor,
        "documents",
        scopeKey,
        key,
        preparedPatch,
        (value) => documentSchema.parse(value),
        options?.expectedUpdatedAt,
      );
    },
    async setFolderDeletion(
      scopeKey: string,
      key: string,
      marker: Folder["_internalDeletion"] | undefined,
      owner?: string,
    ) {
      const { set, unset } = splitPatch({ _internalDeletion: marker });
      const cursor = await executor.query(
        `
        FOR current IN folders
          FILTER current._key == @key && current.scopeKey == @scopeKey && current.mutationPolicy != "system-container" && current.managedPurpose == null
          FILTER @owner == null || current._internalDeletion.owner == @owner
          LIMIT 1
          UPDATE current WITH MERGE(@patch, ZIP(@unset, @unset[* RETURN null])) IN folders OPTIONS { keepNull: false }
          RETURN NEW
      `,
        { key, scopeKey, owner: owner ?? null, patch: set, unset },
      );
      const value = await cursor.next();
      return value
        ? folderSchema.parse(withArangoKey(value as Record<string, unknown>))
        : null;
    },
    async setDocumentDeletion(
      scopeKey: string,
      key: string,
      marker: Document["_internalDeletion"] | undefined,
      owner?: string,
    ) {
      const { set, unset } = splitPatch({ _internalDeletion: marker });
      const cursor = await executor.query(
        `
        FOR current IN documents
          FILTER current._key == @key && current.scopeKey == @scopeKey
          FILTER current.mutationPolicy != "system-only" && current.managedPurpose == null
          FILTER @owner == null || current._internalDeletion.owner == @owner
          LIMIT 1
          UPDATE current WITH MERGE(@patch, ZIP(@unset, @unset[* RETURN null])) IN documents OPTIONS { keepNull: false }
          RETURN NEW
      `,
        { key, scopeKey, owner: owner ?? null, patch: set, unset },
      );
      const value = await cursor.next();
      return value
        ? documentSchema.parse(withArangoKey(value as Record<string, unknown>))
        : null;
    },
    deleteFolder(scopeKey: string, key: string) {
      return scopedDelete(executor, "folders", scopeKey, key, true);
    },
    async deleteDocument(scopeKey: string, key: string) {
      const deleted = await scopedDelete(executor, "documents", scopeKey, key);
      if (deleted)
        await executor.query(
          "FOR binding IN generatedDocumentBindings FILTER binding.scopeKey == @scopeKey && binding.documentKey == @key REMOVE binding IN generatedDocumentBindings",
          { scopeKey, key },
        );
      return deleted;
    },
    deleteVersion(scopeKey: string, key: string) {
      return scopedDelete(executor, "documentVersions", scopeKey, key);
    },
    deleteAudioVersion(scopeKey: string, key: string) {
      return scopedDelete(executor, "documentAudioVersions", scopeKey, key);
    },
    deleteSummary(scopeKey: string, key: string) {
      return scopedDelete(executor, "documentSummaries", scopeKey, key);
    },
    deleteSummaryAudio(scopeKey: string, key: string) {
      return scopedDelete(executor, "documentSummaryAudio", scopeKey, key);
    },
  };
}

export const contentPersistence = createContentPersistence(
  db as unknown as ContentQueryExecutor,
);

export function withContentPersistenceTransaction<T>(
  operation: (
    persistence: ReturnType<typeof createContentPersistence>,
  ) => Promise<T>,
): Promise<T> {
  return withTransaction(
    [
      "folders",
      "documents",
      "generatedDocumentBindings",
      "documentVersions",
      "documentAudioVersions",
      "documentSummaries",
      "documentSummaryAudio",
      "tagAssignments",
      "userHiddens",
      "tripAttachments",
      "trips",
      "scopes",
      "scopeMembers",
      "scopeScopes",
    ],
    (transaction) =>
      operation(
        createContentPersistence(
          transaction as unknown as ContentQueryExecutor,
        ),
      ),
  );
}
