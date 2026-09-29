import type { ConversationRetrieval, ConversationRetrievalCollectionSlug } from "./conversation-client";

export type ConversationRetrievalResult = {
  collectionSlug: ConversationRetrievalCollectionSlug;
  key: string;
  label: string;
  destinationKey?: string;
  destinationCollectionSlug?: ConversationRetrievalCollectionSlug;
  retrieval: ConversationRetrieval;
};

export const RETRIEVAL_LABELS: Record<ConversationRetrievalCollectionSlug, Readonly<{ singular: string; plural: string }>> = {
  folders: { singular: "folder", plural: "folders" },
  files: { singular: "file", plural: "files" },
};

export function conversationRetrievalDestination(result: ConversationRetrievalResult) {
  const { collectionSlug, key, retrieval } = result;
  const searchParams = retrieval.query ? { initialQuery: retrieval.query } : {};
  switch (collectionSlug) {
    case "folders": return { pathname: "/home" as const, params: { folderKey: key, ...searchParams } };
    case "files": return { pathname: "/home" as const, params: { fileKey: key, fileTitle: result.label, ...searchParams } };
    default: return null;
  }
}

export function mergeConversationRetrievalResults(retrievals: readonly ConversationRetrieval[]) {
  const seen = new Set<string>();
  const merged: ConversationRetrievalResult[] = [];
  for (const retrieval of retrievals) {
    for (const group of retrieval.groups) {
      for (const result of group.results) {
        const identity = `${group.collectionSlug}:${result.key}`;
        if (seen.has(identity)) continue;
        const item = { collectionSlug: group.collectionSlug, key: result.key, label: result.label, ...(result.destinationKey ? { destinationKey: result.destinationKey } : {}), ...(result.destinationCollectionSlug ? { destinationCollectionSlug: result.destinationCollectionSlug } : {}), retrieval };
        if (conversationRetrievalDestination(item)) { seen.add(identity); merged.push(item); }
      }
    }
  }
  return merged;
}

export function formatConversationRetrievalSummary(results: readonly ConversationRetrievalResult[]) {
  const counts = new Map<ConversationRetrievalCollectionSlug, number>();
  for (const result of results) counts.set(result.collectionSlug, (counts.get(result.collectionSlug) ?? 0) + 1);
  const parts = [...counts].map(([slug, count]) => `${count} ${count === 1 ? RETRIEVAL_LABELS[slug].singular : RETRIEVAL_LABELS[slug].plural}`);
  if (!parts.length) return "";
  if (parts.length === 1) return `Found ${parts[0]}`;
  return `Found ${parts.slice(0, -1).join(", ")} & ${parts.at(-1)}`;
}
