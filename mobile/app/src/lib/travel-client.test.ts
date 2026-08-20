import { beforeEach, expect, mock, test } from "bun:test";

const calls: { method: string; path: string; body: unknown; config?: unknown }[] = [];
const authState = { organization: { key: "org-key" }, scope: { key: "scope-key" } };
const timestamp = "2026-08-11T10:00:00.000Z";
const place = { key: "place-key", name: "Reykjavik", summary: "A compact North Atlantic capital.", countryCode: "IS", latitude: 64.15, longitude: -21.94, createdAt: timestamp };
const recentPlace = { key: "country-key", kind: "country" as const, name: "Iceland", summary: place.summary, countryCode: "IS", latitude: 64.96, longitude: -19.02, openedAt: timestamp };
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
    if (path === "/travel/places/find") return { data: { success: true, data: { place: detail } } };
    if (path === "/travel/cities/find") return { data: { success: true, data: { city: cityDetail } } };
    if (path === "/travel/places/children/find") return { data: { success: true, data: { cities: childCities } } };
    if (path === "/travel/places") return { data: { success: true, data: { place } } };
    if (path === "/travel/places/open") return { data: { success: true, data: { place: recentPlace } } };
    if (path === "/travel/places/image") return { data: { success: true, data: readyImage } };
    if (path === "/travel/countries/search") return { data: { success: true, data: { country: { name: "Iceland", countryCode: "IS", latitude: 64.96, longitude: -19.02 } } } };
    return { data: { success: true, data: { places: [place], recentPlaces: [recentPlace] } } };
  } },
}));

const client = await import("./travel-client");
beforeEach(() => calls.splice(0));

test("sends and strictly validates the saved-city overview", async () => {
  expect(await client.fetchTravelOverview()).toEqual({ places: [place], recentPlaces: [recentPlace] });
  expect(client.placeSchema.parse(place)).toEqual(place);
  expect(client.placeSchema.safeParse({ ...place, visited: false }).success).toBe(false);
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
  expect(calls[0]).toEqual({ method: "POST", path: "/travel/places/image", body: { organizationKey: "org-key", scopeKey: "scope-key", imageRequestToken: "opaque-image-token" }, config: { timeout: 5 * 60_000, signal: controller.signal } });
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
  expect(calls[0]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", query: "Iceland", country: { name: "Iceland", code: "IS", continent: "Europe", lat: 64.96, lon: -19.02 } });
  expect(calls[0]?.config).toEqual({ timeout: 30_000, signal: controller.signal });
  expect(() => client.findPlace("Iceland", { name: "Iceland", code: "Iceland", continent: "Europe", lat: 64.96, lon: -19.02 })).toThrow();
  expect(() => client.generatePlaceHeroImage({ imageRequestToken: "opaque-image-token", prompt: "untrusted" } as never)).toThrow();
});

test("strictly searches for one country without leaking the workspace scope", async () => {
  const controller = new AbortController();
  expect(await client.searchCountries(" volcanic island ", controller.signal)).toEqual({ name: "Iceland", countryCode: "IS", latitude: 64.96, longitude: -19.02 });
  expect(calls[0]).toEqual({ method: "POST", path: "/travel/countries/search", body: { organizationKey: "org-key", query: "volcanic island" }, config: { timeout: 30_000, signal: controller.signal } });
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

test("asks Core through the Compass assistant surface", async () => {
  expect(await client.askTravelAssistant("Which cities have I saved?", "request-key")).toEqual({ type: "answer", message: "Try Reykjavik in winter.", sources: [] });
  expect(calls[0]?.path).toBe("/assistant/respond");
  expect(await client.askTravelAssistant("What is the weather?", "request-key")).toEqual({ type: "unsupported", message: "This request is not supported in Compass.", sources: [] });
});
