import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import type { CityDetail, PlaceImageResponse } from "./travel-client";
import { hydratePlaceChildren, PLACE_GUIDE_CACHE_MS, PLACE_IMAGE_GC_MS } from "./travel-prefetch";
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

test("hydrates ten ordered city caches and bounds unobserved hero retention", async () => {
  expect(PLACE_GUIDE_CACHE_MS).toBe(Infinity);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started: string[] = [];
  const generate = async ({ imageRequestToken }: { imageRequestToken: string }) => {
    started.push(imageRequestToken);
    await gate;
    return {
      status: "ready",
      image: { status: "ready", title: imageRequestToken, url: "data:image/png;base64,AQ==", width: 1536, height: 1024, mimeType: "image/png" },
      durationMs: 1,
      costUsd: null,
    } satisfies PlaceImageResponse;
  };

  const heroQueries = hydratePlaceChildren(queryClient, context, "IS", names.map((name) => ({ name })), cities, generate);
  await Promise.resolve();

  expect(started).toEqual(cities.map(({ imageRequestToken }) => imageRequestToken));
  cities.forEach((city) => {
    expect(queryClient.getQueryData(compassQueryKeys.cityDetail(context, "IS", city.location.name))).toEqual(city);
  });

  let duplicateCalls = 0;
  const duplicateObservers = cities.map((city) => queryClient.fetchQuery({
    queryKey: compassQueryKeys.cityImage(context, "IS", city.location.name, city.imageRequestToken),
    queryFn: async () => { duplicateCalls += 1; return generate({ imageRequestToken: city.imageRequestToken }); },
    staleTime: PLACE_GUIDE_CACHE_MS,
  }));
  expect(duplicateCalls).toBe(0);

  release();
  await Promise.all([...heroQueries, ...duplicateObservers]);
  expect(started).toHaveLength(10);
  cities.forEach((city) => {
    const query = queryClient.getQueryCache().find({ queryKey: compassQueryKeys.cityImage(context, "IS", city.location.name, city.imageRequestToken), exact: true });
    expect(query?.options.staleTime).toBe(PLACE_GUIDE_CACHE_MS);
    expect(query?.options.gcTime).toBe(PLACE_IMAGE_GC_MS);
    expect(query?.options.retry).toBe(false);
  });
});

test("rejects reordered child details before hydrating caches or starting heroes", () => {
  const queryClient = new QueryClient();
  const reordered = [cities[1]!, cities[0]!, ...cities.slice(2)];
  expect(() => hydratePlaceChildren(queryClient, context, "IS", names.map((name) => ({ name })), reordered, async () => { throw new Error("must not start"); })).toThrow("did not match");
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
});
