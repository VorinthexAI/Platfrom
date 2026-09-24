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
  highlights: { singular: "highlight", plural: "highlights" },
  memories: { singular: "memory", plural: "memories" },
  subjects: { singular: "visual identity", plural: "visual identities" },
  inboxes: { singular: "inbox", plural: "inboxes" },
  "email-tones": { singular: "email tone", plural: "email tones" },
  "email-messages": { singular: "email message", plural: "email messages" },
  "email-drafts": { singular: "email draft", plural: "email drafts" },
  places: { singular: "place", plural: "places" },
  trips: { singular: "trip", plural: "trips" },
  countries: { singular: "country", plural: "countries" },
  books: { singular: "audio book", plural: "audio books" },
  tags: { singular: "tag", plural: "tags" },
  "tag-assignments": { singular: "tagged resource", plural: "tagged resources" },
  tickets: { singular: "ticket", plural: "tickets" },
  notifications: { singular: "notification", plural: "notifications" },
};

/** Only surface a pill when a concrete destination exists for that resource. */
export function conversationRetrievalDestination(result: ConversationRetrievalResult) {
  const { collectionSlug, destinationCollectionSlug, destinationKey, key, retrieval } = result;
  const searchParams = retrieval.query ? { initialQuery: retrieval.query } : {};
  switch (collectionSlug) {
    case "folders": return { pathname: "/capability/[slug]" as const, params: { slug: "archive", assetKey: key, ...(destinationCollectionSlug === "documents" || destinationCollectionSlug === "files" ? { collectionKind: destinationCollectionSlug } : {}), ...searchParams } };
    case "documents":
    case "files": return { pathname: "/capability/[slug]" as const, params: { slug: "archive", documentKey: key, documentTitle: result.label, ...searchParams } };
    case "collections": return { pathname: "/capability/[slug]" as const, params: { slug: "gallery", assetKey: key, ...searchParams } };
    case "images": return { pathname: "/capability/[slug]" as const, params: { slug: "gallery", ...(destinationKey || retrieval.filters?.collectionKey ? { assetKey: destinationKey ?? retrieval.filters!.collectionKey! } : {}), imageKey: key, ...searchParams } };
    case "highlights": return destinationKey ? { pathname: "/capability/[slug]" as const, params: { slug: "gallery", assetKey: destinationKey, highlightKey: key } } : null;
    case "memories": return destinationKey ? { pathname: "/capability/[slug]" as const, params: { slug: "gallery", assetKey: destinationKey, memoryKey: key } } : null;
    case "subjects": return { pathname: "/capability/[slug]" as const, params: { slug: "gallery", subjectKey: key } };
    case "email-messages": return destinationKey || retrieval.filters?.connectorKey ? { pathname: "/capability/[slug]" as const, params: { slug: "signal", connectorKey: destinationKey ?? retrieval.filters!.connectorKey!, signalThreadKey: key, collectionKind: "email-messages", ...searchParams } } : null;
    case "email-drafts": return destinationKey || retrieval.filters?.connectorKey ? { pathname: "/capability/[slug]" as const, params: { slug: "signal", connectorKey: destinationKey ?? retrieval.filters!.connectorKey!, draftKey: key, collectionKind: "email-drafts", ...searchParams } } : null;
    case "inboxes": return destinationKey ? { pathname: "/capability/[slug]" as const, params: { slug: "signal", connectorKey: destinationKey, signalReturn: "root", ...(destinationCollectionSlug === "email-messages" || destinationCollectionSlug === "email-drafts" ? { collectionKind: destinationCollectionSlug, ...searchParams } : {}) } } : null;
    case "email-tones": return { pathname: "/capability/[slug]" as const, params: { slug: "signal", toneKey: key, collectionKind: "email-tones", ...searchParams } };
    case "places": return { pathname: "/capability/[slug]" as const, params: { slug: "compass", placeKey: key, collectionKind: "places", ...searchParams } };
    case "trips": return { pathname: "/capability/[slug]" as const, params: { slug: "compass", tripKey: key, collectionKind: "trips", ...searchParams } };
    case "countries": return { pathname: "/capability/[slug]" as const, params: { slug: "compass", countryCode: key, collectionKind: "countries", ...searchParams } };
    case "books": return { pathname: "/capability/[slug]" as const, params: { slug: "ascend", bookKey: key, ...searchParams } };
    // These do not have a resource-specific screen yet. Do not send them to an unrelated app.
    case "tags":
    case "tag-assignments":
    case "tickets":
    case "notifications": return null;
    default: { const unknownKind: never = collectionSlug; return unknownKind; }
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
