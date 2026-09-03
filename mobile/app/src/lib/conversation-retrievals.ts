import type { AppSearchOutput } from "./app-search-client";
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
  documents: { singular: "document", plural: "documents" },
  files: { singular: "file", plural: "files" },
  collections: { singular: "collection", plural: "collections" },
  images: { singular: "image", plural: "images" },
  inboxes: { singular: "inbox", plural: "inboxes" },
  "email-tones": { singular: "email tone", plural: "email tones" },
  "email-messages": { singular: "email message", plural: "email messages" },
  "email-drafts": { singular: "email draft", plural: "email drafts" },
  places: { singular: "place", plural: "places" },
  trips: { singular: "trip", plural: "trips" },
  countries: { singular: "country", plural: "countries" },
  books: { singular: "audio book", plural: "audio books" },
};

export function mergeConversationRetrievalResults(retrievals: readonly ConversationRetrieval[]) {
  const seen = new Set<string>();
  const merged: ConversationRetrievalResult[] = [];
  for (const retrieval of retrievals) {
    for (const group of retrieval.groups) {
      for (const result of group.results) {
        const identity = `${group.collectionSlug}:${result.key}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        merged.push({ collectionSlug: group.collectionSlug, key: result.key, label: result.label, ...(result.destinationKey ? { destinationKey: result.destinationKey } : {}), ...(result.destinationCollectionSlug ? { destinationCollectionSlug: result.destinationCollectionSlug } : {}), retrieval });
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

export function appSearchResultIdentity(collectionSlug: ConversationRetrievalCollectionSlug, result: unknown) {
  if (!result || typeof result !== "object") return undefined;
  const field = collectionSlug === "countries" ? "countryCode" : "key";
  const identity = (result as Record<string, unknown>)[field];
  return typeof identity === "string" && identity ? identity : undefined;
}

export function validConversationRetrievalIdentities(retrieval: ConversationRetrieval, output: AppSearchOutput) {
  if (output.retrieval) {
    const current = new Set(mergeConversationRetrievalResults([output.retrieval]).map((result) => `${result.collectionSlug}:${result.key}`));
    return new Set(mergeConversationRetrievalResults([retrieval]).filter((result) => current.has(`${result.collectionSlug}:${result.key}`)).map((result) => `${result.collectionSlug}:${result.key}`));
  }
  const valid = new Set<string>();
  for (const group of output.groups) {
    for (const result of group.results) {
      const identity = appSearchResultIdentity(group.collectionSlug, result);
      if (identity) valid.add(`${group.collectionSlug}:${identity}`);
    }
  }
  return new Set(mergeConversationRetrievalResults([retrieval]).filter((result) => valid.has(`${result.collectionSlug}:${result.key}`)).map((result) => `${result.collectionSlug}:${result.key}`));
}

export function filterConversationRetrievalResults(results: readonly ConversationRetrievalResult[], validations: ReadonlyMap<ConversationRetrieval, ReadonlySet<string>>) {
  return results.filter((result) => validations.get(result.retrieval)?.has(`${result.collectionSlug}:${result.key}`) ?? true);
}
