import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import type { CityDetail } from "./travel-client";
import { hydratePlaceChildren, PLACE_GUIDE_CACHE_MS } from "./travel-prefetch";
import { compassQueryKeys } from "./compass-query-keys";

const context = { organizationKey: "org-key", scopeKey: "scope-key" };
const names = ["Reykjavik", "Akureyri", "Husavik", "Vik", "Selfoss", "Hofn", "Isafjordur", "Stykkisholmur", "Seydisfjordur", "Borgarnes"];
const cities = names.map((name, index): CityDetail => ({
  location: { kind: "place", name, countryCode: "IS", country: "Iceland", continent: "Europe", region: null, city: name, latitude: 64 + index / 10, longitude: -22 + index / 10 },
  title: name,
  summary: `${name} summary`,
  culture: `${name} culture`,
  food: `${name} food`,
  whyVisit: `${name} visit`,
  imageRequestToken: `image-token-${index}`,
}));

test("hydrates ten ordered city guide caches without starting hero generation", () => {
  expect(PLACE_GUIDE_CACHE_MS).toBe(Infinity);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  hydratePlaceChildren(queryClient, context, "IS", names.map((name) => ({ name })), cities);

  cities.forEach((city) => {
    expect(queryClient.getQueryData(compassQueryKeys.cityDetail(context, "IS", city.location.name))).toEqual(city);
    expect(queryClient.getQueryData(compassQueryKeys.cityImage(context, "IS", city.location.name, city.imageRequestToken))).toBeUndefined();
  });
});

test("rejects reordered child details before hydrating caches or starting heroes", () => {
  const queryClient = new QueryClient();
  const reordered = [cities[1]!, cities[0]!, ...cities.slice(2)];
  expect(() => hydratePlaceChildren(queryClient, context, "IS", names.map((name) => ({ name })), reordered)).toThrow("did not match");
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
});
