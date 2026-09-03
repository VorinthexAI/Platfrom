import { beforeEach, expect, mock, test } from "bun:test";

const calls: { method: string; path: string; body: unknown; config?: unknown }[] = [];
let deleteData: unknown;
const authState = { organization: { key: "org-key" }, scope: { key: "scope-key" } };
const timestamp = "2026-08-11T10:00:00.000Z";
const place = { key: "place-key", kind: "place" as const, name: "Reykjavik", summary: "A compact North Atlantic capital.", countryCode: "IS", latitude: 64.15, longitude: -21.94, status: "wishlist" as const, isFavorite: false, createdAt: timestamp, coverUrl: "https://signed.test/media/reykjavik.png" };
const recentPlace = { key: "country-key", kind: "country" as const, name: "Iceland", summary: place.summary, countryCode: "IS", latitude: 64.96, longitude: -19.02, openedAt: timestamp, coverUrl: "https://signed.test/media/iceland.png" };
const tripPlace = { ...place };
const trip = { key: "trip-key", name: "Iceland winter", description: "Northern lights", createdAt: timestamp, updatedAt: timestamp, status: "planned" as const, isFavorite: false, coverImageKey: "cover-key", places: [tripPlace], attachments: [{ type: "folder" as const, key: "folder-key" }], coverUrl: place.coverUrl };
const guide = { key: "guide-key", tripKey: trip.key, name: "Travel guide 11 Aug 2026", content: "# Arrival\nLand before dusk.", createdAt: timestamp, updatedAt: timestamp };
const reference = { key: "reference-key", placeKey: place.key, kind: "brief" as const, name: "Brief 11 Aug 2026", content: "# Highlights\nWalk the harbor.", createdAt: timestamp, updatedAt: timestamp };
const placeSearchResults = [{ kind: "country" as const, name: "Iceland", country: "Iceland", countryCode: "IS", continent: "Europe", summary: "A North Atlantic island country.", lat: 64.96, long: -19.02 }];
const summary = "Iceland offers dramatic volcanic landscapes, immense glaciers, black-sand coasts, geothermal pools, and compact towns shaped by the North Atlantic. Travelers can explore waterfalls and lava fields by day, then experience a creative food and music scene in Reykjavik. Summer brings long daylight for road trips, while winter offers quieter scenery and northern lights. Strong infrastructure makes remote nature unusually accessible, though rapidly changing weather rewards flexible plans and careful local guidance.";
const popularCities = ["Reykjavik", "Akureyri", "Husavik", "Vik", "Selfoss", "Hofn", "Isafjordur", "Stykkisholmur", "Seydisfjordur", "Borgarnes"].map((name, index) => ({ name, latitude: 64 + index / 10, longitude: -22 + index / 10 }));
const detail = {
  location: { kind: "country", name: "Iceland", countryCode: "IS", country: "Iceland", continent: "Europe", region: null, city: null, latitude: 64.96, longitude: -19.02 },
  title: "Iceland", summary,
  culture: "A literary, musical, and design-focused culture combines close community life with sagas, swimming pools, festivals, and a practical relationship with severe landscapes.",
  food: "Icelandic cooking emphasizes exceptional seafood, lamb, rye bread, cultured dairy, greenhouse vegetables, and modern restaurants that reinterpret preserved regional ingredients.",
  whyVisit: "Visit for concentrated geological drama, accessible wilderness, geothermal bathing, distinctive Nordic creativity, and road journeys that change character with every season.",
  popularCities,
  imageRequestToken: "opaque-image-token",
  childrenRequestToken: "opaque-children-token",
};
const readyImage = {
  status: "ready" as const,
  image: { status: "ready" as const, title: "Iceland travel interpretation", url: "data:image/png;base64,aW1hZ2Uw", width: 1536 as const, height: 1024 as const, mimeType: "image/png" as const },
  durationMs: 12_345,
  costUsd: 0.04,
};
const cityDetail = { ...detail, location: { ...detail.location, kind: "place" as const, name: "Reykjavik", city: "Reykjavik" }, title: "Reykjavik" };
delete (cityDetail as { popularCities?: unknown }).popularCities;
delete (cityDetail as { childrenRequestToken?: unknown }).childrenRequestToken;
const childCities = popularCities.map(({ name }, index) => ({
  ...cityDetail,
  location: { ...cityDetail.location, name, city: name, latitude: 64 + index / 10, longitude: -22 + index / 10 },
  title: name,
  imageRequestToken: `city-image-token-${index}`,
}));

mock.module("@/state/auth", () => ({ useAuthStore: { getState: () => authState } }));
mock.module("./api-client", () => ({
  apiClient: { post: async (path: string, body: unknown, config?: unknown) => {
    calls.push({ method: "POST", path, body, config });
    if (path === "/assistant/respond") return { data: (body as { input?: { message?: string } }).input?.message.includes("weather") ? { type: "unsupported", message: "This request is not supported in Compass.", sources: [] } : { type: "answer", message: "Try Reykjavik in winter.", sources: [] } };
    if (path === "/app/search") {
      const input = body as { query: string; collectionSlugs: string[] };
      return { data: { success: true, data: { query: input.query, groups: input.collectionSlugs.map((collectionSlug) => ({ collectionSlug, results: collectionSlug === "places" ? [place] : collectionSlug === "trips" ? [trip] : collectionSlug === "countries" ? [{ name: "Iceland", countryCode: "IS", latitude: 64.96, longitude: -19.02 }] : [] })) } } };
    }
    if (path === "/travel/places/find") return { data: { success: true, data: { results: placeSearchResults } } };
    if (path === "/travel/places/guide") return { data: { success: true, data: { place: detail } } };
    if (path === "/travel/cities/find") return { data: { success: true, data: { city: cityDetail } } };
    if (path === "/travel/places/children/find") return { data: { success: true, data: { cities: childCities } } };
    if (path === "/travel/places") return { data: { success: true, data: { place } } };
    if (path === "/travel/places/update") return { data: { success: true, data: { place } } };
    if (path === "/travel/places/delete") return { data: { success: true, data: deleteData } };
    if (path === "/travel/places/open") return { data: { success: true, data: { place: recentPlace } } };
    if (path === "/travel/places/search") return { data: { success: true, data: { places: [place] } } };
    if (path === "/travel/trips/list") return { data: { success: true, data: { trips: [trip] } } };
    if (path === "/travel/trips/guides/list") return { data: { success: true, data: { guides: [guide] } } };
    if (path === "/travel/trips/guides/generate") return { data: { success: true, data: { guide } } };
    if (path === "/travel/places/references/list") return { data: { success: true, data: { references: [reference] } } };
    if (path === "/travel/places/references/generate") return { data: { success: true, data: { reference } } };
    if (path === "/travel/trips/search") return { data: { success: true, data: { trips: [trip] } } };
    if (path === "/travel/trips") return { data: { success: true, data: { trip } } };
    if (path === "/travel/trips/update") return { data: { success: true, data: { trip } } };
    if (path === "/travel/trips/delete") return { data: { success: true, data: deleteData } };
    if (path === "/travel/trips/attachments/set") return { data: { success: true, data: { trip } } };
    if (path === "/travel/places/image") return { data: { success: true, data: readyImage } };
    if (path === "/travel/countries/search") return { data: { success: true, data: { country: { name: "Iceland", countryCode: "IS", latitude: 64.96, longitude: -19.02 } } } };
    return { data: { success: true, data: { places: [place], recentPlaces: [recentPlace] } } };
  } },
}));

const client = await import("./travel-client");
beforeEach(() => {
  calls.splice(0);
  deleteData = { tripKey: trip.key };
});

test("sends and strictly validates the saved-city overview", async () => {
  expect(await client.fetchTravelOverview()).toEqual({ places: [place], recentPlaces: [recentPlace] });
  expect(client.placeSchema.parse(place)).toEqual(place);
  expect(client.placeSchema.safeParse({ ...place, visited: false }).success).toBe(false);
  expect(client.placeSchema.safeParse({ ...place, status: "planned" }).success).toBe(false);
  expect(client.placeSchema.safeParse({ ...place, kind: "city" }).success).toBe(false);
  expect(client.placeSchema.parse({ ...place, summary: "" }).summary).toBe("");
  expect(calls[0]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key" });
});

test("strictly validates focused web-grounded travel recommendations", () => {
  expect(client.placeDetailSchema.parse(detail)).toEqual(detail);
  expect(() => client.placeDetailSchema.parse({ ...detail, unexpected: true })).toThrow();
  expect(() => client.placeDetailSchema.parse({ ...detail, summary: "" })).toThrow();
  expect(() => client.placeDetailSchema.parse({ ...detail, culture: undefined })).toThrow();
  expect(() => client.placeDetailSchema.parse({ ...detail, popularCities: popularCities.slice(0, 9) })).toThrow();
  expect(() => client.placeDetailSchema.parse({ ...detail, popularCities: [...popularCities.slice(0, 9), { ...popularCities[0]!, name: "reykjavik" }] })).toThrow();
  expect(() => client.placeDetailSchema.parse({ ...detail, popularCities: [{ ...popularCities[0]!, latitude: 100 }, ...popularCities.slice(1)] })).toThrow();
  expect(() => client.placeDetailSchema.parse({ ...detail, facts: [] })).toThrow();
  expect(() => client.placeDetailSchema.parse({ ...detail, childrenRequestToken: undefined })).toThrow();
  expect(() => client.cityDetailSchema.parse({ ...cityDetail, childrenRequestToken: "not-allowed" })).toThrow();
});

test("strictly scopes city guides to their supplied country", async () => {
  expect(client.cityDetailSchema.parse(cityDetail)).toEqual(cityDetail);
  expect(() => client.cityDetailSchema.parse({ ...cityDetail, popularCities })).toThrow();
  const controller = new AbortController();
  await client.findCity("Reykjavik", { name: "Iceland", code: "IS", continent: "Europe", lat: 64.96, lon: -19.02 }, controller.signal);
  expect(calls[0]).toEqual({ method: "POST", path: "/travel/cities/find", body: { organizationKey: "org-key", scopeKey: "scope-key", city: "Reykjavik", country: { name: "Iceland", code: "IS", continent: "Europe", lat: 64.96, lon: -19.02 } }, config: { timeout: 30_000, signal: controller.signal } });
});

test("strictly parses one transient hero and sends only the opaque token", async () => {
  expect(client.placeImageResponseSchema.parse(readyImage)).toEqual(readyImage);
  expect(() => client.placeImageResponseSchema.parse({ ...readyImage, images: [readyImage.image] })).toThrow();
  expect(() => client.placeImageResponseSchema.parse({ ...readyImage, image: { ...readyImage.image, sourcePageUrl: "https://example.com" } })).toThrow();
  expect(() => client.placeImageResponseSchema.parse({ ...readyImage, image: { ...readyImage.image, url: "data:image/webp;base64,aW1hZ2Uw" } })).toThrow();
  expect(() => client.placeImageResponseSchema.parse({ ...readyImage, image: { ...readyImage.image, height: 864 } })).toThrow();
  const oversizedUrl = `data:image/png;base64,${"A".repeat(Math.ceil((client.PLACE_IMAGE_PNG_MAX_BYTES + 1) / 3) * 4)}`;
  expect(() => client.placeImageResponseSchema.parse({ ...readyImage, image: { ...readyImage.image, url: oversizedUrl } })).toThrow();
  const controller = new AbortController();
  expect(await client.generatePlaceHeroImage({ imageRequestToken: "opaque-image-token" }, controller.signal)).toEqual(readyImage);
  expect(calls[0]).toEqual({ method: "POST", path: "/travel/places/image", body: { organizationKey: "org-key", scopeKey: "scope-key", imageRequestToken: "opaque-image-token" }, config: { timeout: 15_000, signal: controller.signal } });
});

test("finds exactly ten ordered city details with trusted local context and cancellation", async () => {
  const controller = new AbortController();
  expect(await client.findPlaceChildren("opaque-children-token", controller.signal)).toEqual(childCities);
  expect(calls[0]).toEqual({
    method: "POST",
    path: "/travel/places/children/find",
    body: { organizationKey: "org-key", scopeKey: "scope-key", childrenRequestToken: "opaque-children-token" },
    config: { timeout: 30_000, signal: controller.signal },
  });
  expect(() => client.cityDetailSchema.parse({ ...cityDetail, popularCities })).toThrow();
});

test("passes cancellation and authoritative country context", async () => {
  const controller = new AbortController();
  await client.findPlace("Iceland", { name: "Iceland", code: "IS", continent: "Europe", lat: 64.96, lon: -19.02 }, controller.signal);
  expect(calls[0]?.path).toBe("/travel/places/guide");
  expect(calls[0]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", query: "Iceland", country: { name: "Iceland", code: "IS", continent: "Europe", lat: 64.96, lon: -19.02 } });
  expect(calls[0]?.config).toEqual({ timeout: 30_000, signal: controller.signal });
  expect(() => client.findPlace("Iceland", { name: "Iceland", code: "Iceland", continent: "Europe", lat: 64.96, lon: -19.02 })).toThrow();
  expect(() => client.generatePlaceHeroImage({ imageRequestToken: "opaque-image-token", prompt: "untrusted" } as never)).toThrow();
});

test("strictly searches for one country without leaking the workspace scope", async () => {
  const controller = new AbortController();
  expect(await client.searchCountries(" volcanic island ", controller.signal)).toEqual({ name: "Iceland", countryCode: "IS", latitude: 64.96, longitude: -19.02 });
  expect(calls[0]).toEqual({ method: "POST", path: "/app/search", body: { organizationKey: "org-key", scopeKey: "scope-key", query: "volcanic island", collectionSlugs: ["countries"], recordHistory: true, limit: 1 }, config: { timeout: 15_000, signal: controller.signal } });
  expect(client.countrySearchResultSchema.safeParse({ country: { name: "Iceland", countryCode: "IS", latitude: 64.96, longitude: -19.02, continent: "Europe" } }).success).toBe(false);
  expect(client.countrySearchResultSchema.parse({ country: null })).toEqual({ country: null });
});

test("strictly parses recent places and records each place open", async () => {
  expect(client.recentPlaceSchema.parse(recentPlace)).toEqual(recentPlace);
  expect(client.travelOverviewSchema.safeParse({ places: [place], recentPlaces: Array.from({ length: 26 }, (_, index) => ({ ...recentPlace, key: `place-${index}` })) }).success).toBe(false);
  const controller = new AbortController();
  expect(await client.openPlace(recentPlace.name, recentPlace.countryCode, controller.signal)).toEqual(recentPlace);
  expect(calls[0]).toEqual({ method: "POST", path: "/travel/places/open", body: { organizationKey: "org-key", scopeKey: "scope-key", name: recentPlace.name, countryCode: recentPlace.countryCode }, config: { timeout: 30_000, signal: controller.signal } });
});

test("saves a generated place through the canonical travel route", async () => {
  const controller = new AbortController();
  const input = { name: place.name, summary: place.summary, countryCode: place.countryCode, latitude: place.latitude, longitude: place.longitude, imageRequestToken: detail.imageRequestToken };
  expect(await client.createPlace(input, controller.signal)).toEqual(place);
  expect(calls[0]).toEqual({ method: "POST", path: "/travel/places", body: { organizationKey: "org-key", scopeKey: "scope-key", ...input }, config: { timeout: 30_000, signal: controller.signal } });
  expect(() => client.createPlace({ ...input, summary: "" })).toThrow();
  expect(() => client.createPlace({ ...input, imageRequestToken: "" })).toThrow();
});

test("updates strict place status and favorite fields", async () => {
  const controller = new AbortController();
  expect(await client.updatePlace({ placeKey: place.key, status: "visited", isFavorite: true }, controller.signal)).toEqual(place);
  expect(calls[0]).toEqual({ method: "POST", path: "/travel/places/update", body: { organizationKey: "org-key", scopeKey: "scope-key", placeKey: place.key, status: "visited", isFavorite: true }, config: { timeout: 30_000, signal: controller.signal } });
  await expect(client.updatePlace({ placeKey: place.key })).rejects.toThrow();
  await expect(client.updatePlace({ placeKey: place.key, status: "completed" } as never)).rejects.toThrow();
  await expect(client.updatePlace({ placeKey: place.key, isFavorite: true, unknown: true } as never)).rejects.toThrow();
});

test("deletes a place through a strict context-scoped request", async () => {
  deleteData = { placeKey: place.key };
  const controller = new AbortController();
  expect(await client.deletePlace(place.key, controller.signal)).toEqual({ placeKey: place.key });
  expect(calls[0]).toEqual({ method: "POST", path: "/travel/places/delete", body: { organizationKey: "org-key", scopeKey: "scope-key", placeKey: place.key }, config: { timeout: 30_000, signal: controller.signal } });
  await expect(client.deletePlace("")).rejects.toThrow();
  deleteData = { placeKey: place.key, unknown: true };
  await expect(client.deletePlace(place.key)).rejects.toThrow();
});

test("finds one to five strict direct country and city results", async () => {
  const controller = new AbortController();
  expect(await client.findPlaces(" Iceland ", controller.signal)).toEqual(placeSearchResults);
  expect(calls[0]).toEqual({ method: "POST", path: "/travel/places/find", body: { organizationKey: "org-key", scopeKey: "scope-key", query: "Iceland" }, config: { timeout: 30_000, signal: controller.signal } });
  expect(client.placeSearchResultSchema.safeParse({ ...placeSearchResults[0], extra: true }).success).toBe(false);
  await expect(client.findPlaces(" ")).rejects.toThrow();
  await expect(client.findPlaces("x")).rejects.toThrow();
  await expect(client.findPlaces("x".repeat(501))).rejects.toThrow();
});

test("semantically searches strict saved place DTOs", async () => {
  const controller = new AbortController();
  expect(await client.searchPlaces(" volcanic capital ", controller.signal)).toEqual([place]);
  expect(calls[0]).toEqual({ method: "POST", path: "/app/search", body: { organizationKey: "org-key", scopeKey: "scope-key", query: "volcanic capital", collectionSlugs: ["places"], recordHistory: true, limit: 50 }, config: { timeout: 15_000, signal: controller.signal } });
  await client.searchPlaces(" volcanic capital ", controller.signal, false);
  expect(calls[1]?.body).toMatchObject({ query: "volcanic capital", recordHistory: false });
});

test("lists trips separately from the travel overview with strict DTOs", async () => {
  const controller = new AbortController();
  expect(await client.listTrips(controller.signal)).toEqual([trip]);
  expect(calls[0]).toEqual({ method: "POST", path: "/travel/trips/list", body: { organizationKey: "org-key", scopeKey: "scope-key" }, config: { timeout: 30_000, signal: controller.signal } });
  expect(client.tripSchema.safeParse({ ...trip, places: [{ ...tripPlace, coverUrl: undefined }] }).success).toBe(true);
  expect(client.tripSchema.safeParse({ ...trip, updatedAt: undefined }).success).toBe(false);
  expect(client.tripSchema.safeParse({ ...trip, isFavorite: undefined }).success).toBe(false);
  expect(client.tripSchema.safeParse({ ...trip, status: undefined }).success).toBe(false);
  expect(client.tripSchema.safeParse({ ...trip, attachments: undefined }).success).toBe(false);
  expect(client.tripSchema.safeParse({ ...trip, attachments: [{ type: "image", key: "image-key" }] }).success).toBe(false);
  expect(client.tripSchema.safeParse({ ...trip, attachments: [trip.attachments[0], trip.attachments[0]] }).success).toBe(false);
  expect(client.tripSchema.safeParse({ ...trip, places: [tripPlace, tripPlace] }).success).toBe(false);
  expect(client.tripSchema.safeParse({ ...trip, places: [] }).success).toBe(true);
  expect(client.tripSchema.safeParse({ ...trip, unknown: true }).success).toBe(false);
});

test("semantically searches strict trip DTOs", async () => {
  const controller = new AbortController();
  expect(await client.searchTrips(" northern lights ", controller.signal)).toEqual([trip]);
  expect(calls[0]).toEqual({ method: "POST", path: "/app/search", body: { organizationKey: "org-key", scopeKey: "scope-key", query: "northern lights", collectionSlugs: ["trips"], recordHistory: true, limit: 50 }, config: { timeout: 15_000, signal: controller.signal } });
  await client.searchTrips(" northern lights ", controller.signal, false);
  expect(calls[1]?.body).toMatchObject({ query: "northern lights", recordHistory: false });
});

test("lists and generates strict persisted trip guides with trusted workspace context", async () => {
  const controller = new AbortController();
  expect(await client.listTripGuides(trip.key, controller.signal)).toEqual([guide]);
  expect(calls[0]).toEqual({ method: "POST", path: "/travel/trips/guides/list", body: { organizationKey: "org-key", scopeKey: "scope-key", tripKey: trip.key }, config: { timeout: 30_000, signal: controller.signal } });
  expect(await client.generateTripGuide(trip.key, " guide-request ", controller.signal)).toEqual(guide);
  expect(calls[1]).toEqual({ method: "POST", path: "/travel/trips/guides/generate", body: { organizationKey: "org-key", scopeKey: "scope-key", tripKey: trip.key, idempotencyKey: "guide-request" }, config: { timeout: 60_000, signal: controller.signal } });
  expect(client.tripGuideSchema.safeParse({ ...guide, extra: true }).success).toBe(false);
  expect(client.tripGuideSchema.safeParse({ ...guide, content: "" }).success).toBe(false);
  expect(client.tripGuideSchema.safeParse({ ...guide, updatedAt: undefined }).success).toBe(false);
  await expect(client.listTripGuides("")).rejects.toThrow();
  await expect(client.generateTripGuide(trip.key, "")).rejects.toThrow();
});

test("lists and generates strict kind-scoped Archive place references", async () => {
  const controller = new AbortController();
  expect(await client.listPlaceReferences(place.key, "brief", controller.signal)).toEqual([reference]);
  expect(calls[0]).toEqual({ method: "POST", path: "/travel/places/references/list", body: { organizationKey: "org-key", scopeKey: "scope-key", placeKey: place.key, kind: "brief" }, config: { timeout: 30_000, signal: controller.signal } });
  expect(await client.generatePlaceReference(place.key, "brief", " reference-request ", controller.signal)).toEqual(reference);
  expect(calls[1]).toEqual({ method: "POST", path: "/travel/places/references/generate", body: { organizationKey: "org-key", scopeKey: "scope-key", placeKey: place.key, kind: "brief", idempotencyKey: "reference-request" }, config: { timeout: 60_000, signal: controller.signal } });
  expect(client.placeReferenceSchema.safeParse({ ...reference, extra: true }).success).toBe(false);
  expect(client.placeReferenceSchema.safeParse({ ...reference, content: "" }).success).toBe(false);
  expect(client.placeReferenceSchema.safeParse({ ...reference, updatedAt: undefined }).success).toBe(false);
  await expect(client.listPlaceReferences("", "brief")).rejects.toThrow();
  await expect(client.listPlaceReferences(place.key, "hotels" as never)).rejects.toThrow();
  await expect(client.generatePlaceReference(place.key, "brief", "")).rejects.toThrow();
});

test("creates a strict trip and rejects blank or duplicate input", async () => {
  const controller = new AbortController();
  const input = { name: " Iceland winter ", description: " Northern lights ", placeKeys: [place.key], idempotencyKey: "request-1" };
  expect(await client.createTrip(input, controller.signal)).toEqual(trip);
  expect(calls[0]).toEqual({ method: "POST", path: "/travel/trips", body: { organizationKey: "org-key", scopeKey: "scope-key", name: "Iceland winter", description: "Northern lights", placeKeys: [place.key], idempotencyKey: "request-1" }, config: { timeout: 30_000, signal: controller.signal } });
  await expect(client.createTrip({ name: " ", placeKeys: [place.key], idempotencyKey: "request-2" })).rejects.toThrow();
  await expect(client.createTrip({ name: "Trip", description: " ", placeKeys: [place.key], idempotencyKey: "request-3" })).rejects.toThrow();
  await expect(client.createTrip({ name: "Trip", placeKeys: [place.key, place.key], idempotencyKey: "request-4" })).rejects.toThrow();
  await expect(client.createTrip({ ...input, unknown: true } as never)).rejects.toThrow();
});

test("updates trip fields without collapsing null into omission and preserves place order", async () => {
  const controller = new AbortController();
  const input = { tripKey: trip.key, name: " Iceland spring ", description: null, coverImageKey: null, isFavorite: true, status: "completed" as const, placeKeys: ["place-two", place.key] };
  expect(await client.updateTrip(input, controller.signal)).toEqual(trip);
  expect(calls[0]).toEqual({
    method: "POST",
    path: "/travel/trips/update",
    body: { organizationKey: "org-key", scopeKey: "scope-key", tripKey: trip.key, name: "Iceland spring", description: null, coverImageKey: null, isFavorite: true, status: "completed", placeKeys: ["place-two", place.key] },
    config: { timeout: 30_000, signal: controller.signal },
  });

  await client.updateTrip({ tripKey: trip.key, isFavorite: false });
  expect(calls[1]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", tripKey: trip.key, isFavorite: false });
  await expect(client.updateTrip({ tripKey: trip.key })).rejects.toThrow();
  await expect(client.updateTrip({ tripKey: trip.key, description: undefined })).rejects.toThrow();
  await expect(client.updateTrip({ tripKey: trip.key, description: " " })).rejects.toThrow();
  await expect(client.updateTrip({ tripKey: trip.key, placeKeys: [place.key, place.key] })).rejects.toThrow();
  await expect(client.updateTrip({ tripKey: trip.key, placeKeys: Array.from({ length: 101 }, (_, index) => `place-${index}`) })).rejects.toThrow();
  await expect(client.updateTrip({ tripKey: trip.key, isFavorite: true, unknown: true } as never)).rejects.toThrow();
});

test("replaces strict ordered trip attachments", async () => {
  const controller = new AbortController();
  const attachments = [{ type: "folder" as const, key: "folder-key" }, { type: "collection" as const, key: "collection-key" }];
  expect(await client.setTripAttachments({ tripKey: trip.key, attachments }, controller.signal)).toEqual(trip);
  expect(calls[0]).toEqual({
    method: "POST",
    path: "/travel/trips/attachments/set",
    body: { organizationKey: "org-key", scopeKey: "scope-key", tripKey: trip.key, attachments },
    config: { timeout: 30_000, signal: controller.signal },
  });
  await expect(client.setTripAttachments({ tripKey: trip.key, attachments: [{ type: "image", key: "image-key" }] } as never)).rejects.toThrow();
  await expect(client.setTripAttachments({ tripKey: trip.key, attachments: [attachments[0], attachments[0]] })).rejects.toThrow();
  await expect(client.setTripAttachments({ tripKey: trip.key, attachments: Array.from({ length: 101 }, (_, index) => ({ type: "folder" as const, key: `folder-${index}` })) })).rejects.toThrow();
  await expect(client.setTripAttachments({ tripKey: trip.key, attachments, unknown: true } as never)).rejects.toThrow();
});

test("deletes a trip through the strict canonical response", async () => {
  const controller = new AbortController();
  expect(await client.deleteTrip(trip.key, controller.signal)).toEqual({ tripKey: trip.key });
  expect(calls[0]).toEqual({ method: "POST", path: "/travel/trips/delete", body: { organizationKey: "org-key", scopeKey: "scope-key", tripKey: trip.key }, config: { timeout: 30_000, signal: controller.signal } });
  await expect(client.deleteTrip("")).rejects.toThrow();
  deleteData = { tripKey: trip.key, unknown: true };
  await expect(client.deleteTrip(trip.key)).rejects.toThrow();
});

test("asks Core through the Compass assistant surface", async () => {
  expect(await client.askTravelAssistant("Which cities have I saved?", "request-key")).toEqual({ type: "answer", message: "Try Reykjavik in winter.", sources: [] });
  expect(calls[0]?.path).toBe("/assistant/respond");
  expect(await client.askTravelAssistant("What is the weather?", "request-key")).toEqual({ type: "unsupported", message: "This request is not supported in Compass.", sources: [] });
});
