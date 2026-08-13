import { expect, mock, test } from "bun:test";

mock.module("@/state/auth", () => ({
  useAuthStore: { getState: () => ({}) },
}));
mock.module("./api-client", () => ({
  apiClient: { post: () => { throw new Error("Unexpected API call"); } },
}));

const { findInitialMediaCollection } = await import("./gallery-client");

const collection = (name: string, key: string) => ({
  key,
  name,
  description: null,
  count: 0,
  coverUrl: null,
});

test("selects the provisioned My Images collection for initial Gallery navigation", () => {
  const collections = [collection("Trips", "trips"), collection("My Images", "default")];

  expect(findInitialMediaCollection(collections)).toEqual(collections[1]);
});

test("leaves legacy users on the collections overview", () => {
  const collections = [collection("Trips", "trips"), collection("my images", "legacy")];

  expect(findInitialMediaCollection(collections)).toBeUndefined();
  expect(collections).toHaveLength(2);
});
