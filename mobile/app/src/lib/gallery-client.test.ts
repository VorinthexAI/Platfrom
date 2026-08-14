import { expect, mock, test } from "bun:test";

mock.module("@/state/auth", () => ({
  useAuthStore: { getState: () => ({}) },
}));
mock.module("./api-client", () => ({
  apiClient: { post: () => { throw new Error("Unexpected API call"); } },
}));

const { filterCollections } = await import("./gallery-client");

const collection = (name: string, key: string) => ({
  key,
  name,
  description: null,
  count: 0,
  coverUrl: null,
});

test("filters collections by name without changing their hierarchy", () => {
  const collections = [collection("Alpine Trips", "trips"), collection("My Images", "default")];

  expect(filterCollections(collections, "alpine")).toEqual([collections[0]]);
});

test("returns every collection for an empty search", () => {
  const collections = [collection("Trips", "trips"), collection("My Images", "default")];

  expect(filterCollections(collections, "  ")).toEqual(collections);
});
