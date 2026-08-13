import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import {
  contentQueryKeys,
  invalidateContentLocations,
  replaceCachedContentDocument,
  replaceCachedContentFolder,
} from "./content-query-cache";
import type { ContentContext } from "./content-client";

const context: ContentContext = {
  organizationKey: "organization-a",
  scopeKey: "scope-a",
  agentKey: "agent-a",
};

const otherContext: ContentContext = {
  organizationKey: "organization-b",
  scopeKey: "scope-b",
  agentKey: "agent-b",
};

test("scopes Archive cache keys by the complete content context", () => {
  expect(contentQueryKeys.location(context, "folder-a")).not.toEqual(contentQueryKeys.location(otherContext, "folder-a"));
  expect(contentQueryKeys.document(context, "document-a")).not.toEqual(contentQueryKeys.document(otherContext, "document-a"));
  expect(contentQueryKeys.location(context)).not.toEqual(contentQueryKeys.location(context, "folder-a"));
});

test("patches cached document and folder metadata without evicting note content", () => {
  const client = new QueryClient();
  const locationKey = contentQueryKeys.location(context, "folder-a");
  const documentKey = contentQueryKeys.document(context, "document-a");
  client.setQueryData(locationKey, {
    folders: [{ key: "folder-b", name: "Before" }],
    documents: [{ key: "document-a", name: "Before", isFavorite: false, updatedAt: "before" }],
  });
  client.setQueryData(documentKey, { key: "document-a", name: "Before", isFavorite: false, updatedAt: "before", content: "Cached body" });

  replaceCachedContentDocument(client, context, { key: "document-a", name: "After", isFavorite: true, updatedAt: "after" });
  replaceCachedContentFolder(client, context, { key: "folder-b", name: "Renamed" });

  expect(client.getQueryData<any>(locationKey)).toEqual({
    folders: [{ key: "folder-b", name: "Renamed" }],
    documents: [{ key: "document-a", name: "After", isFavorite: true, updatedAt: "after" }],
  });
  expect(client.getQueryData<any>(documentKey).content).toBe("Cached body");
});

test("invalidates only the affected source and destination locations", async () => {
  const client = new QueryClient();
  const source = contentQueryKeys.location(context, "source");
  const destination = contentQueryKeys.location(context, "destination");
  const unrelated = contentQueryKeys.location(context, "unrelated");
  client.setQueryData(source, { folders: [], documents: [] });
  client.setQueryData(destination, { folders: [], documents: [] });
  client.setQueryData(unrelated, { folders: [], documents: [] });

  await invalidateContentLocations(client, context, ["source", "destination", "source"]);

  expect(client.getQueryState(source)?.isInvalidated).toBe(true);
  expect(client.getQueryState(destination)?.isInvalidated).toBe(true);
  expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
});
