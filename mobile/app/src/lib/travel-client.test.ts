import { beforeEach, expect, mock, test } from "bun:test";

const calls: { method: string; path: string; body: unknown; config?: unknown }[] = [];
const authState = { organization: { key: "org-key" }, scope: { key: "scope-key" } };
const timestamp = "2026-08-11T10:00:00.000Z";
const place = { key: "place-key", kind: "country", name: "Iceland", latitude: 64.96, longitude: -19.02, countryCode: "IS", country: "Iceland", continent: "Europe", city: null, wishlist: false, visited: false, createdAt: timestamp, updatedAt: timestamp };
const trip = { key: "trip-key", name: "North", description: null, startDate: null, endDate: null, itinerary: [], createdAt: timestamp, updatedAt: timestamp };
const assetConcepts = [
  { title: "Overview", prompt: "Role: hero. Complete country hero." },
  { title: "Coast", prompt: "Role: scene-1. Complete coastal scene." },
  { title: "City", prompt: "Role: scene-2. Complete urban scene." },
  { title: "Garden", prompt: "Role: scene-3. Complete garden scene." },
] as const;
const detail = {
  location: { kind: "country", name: "Iceland", countryCode: "IS", country: "Iceland", continent: "Europe", region: null, city: null, latitude: 64.96, longitude: -19.02 },
  title: "Iceland",
  summary: "A North Atlantic island shaped by fire and ice.",
  facts: [{ label: "Capital", value: "Reykjavik" }, { label: "Population", value: "About 390,000" }, { label: "Region", value: "Nordic Europe" }],
  highlights: [{ title: "Golden Circle", description: "A route through major geological landmarks." }],
  practicalInfo: { bestTimeToVisit: "Summer for long daylight.", languages: ["Icelandic"], currency: "Icelandic krona", timeZone: "UTC", safety: "Monitor weather and road conditions.", entryRequirements: "Verify current requirements with official authorities." },
  assetConcepts,
  imageRequestToken: "opaque-image-token",
};
const readyImages = {
  status: "ready" as const,
  images: assetConcepts.map((concept, index) => ({ role: ["hero", "scene-1", "scene-2", "scene-3"][index], status: "ready", title: concept.title, url: `data:image/webp;base64,aW1hZ2Ut${index}A==`, width: 864, height: 1536, mimeType: "image/webp" })),
  durationMs: 12_345,
  costUsd: 0.16,
};

mock.module("@/state/auth", () => ({ useAuthStore: { getState: () => authState } }));
mock.module("./api-client", () => ({
  apiClient: {
    post: async (path: string, body: unknown, config?: unknown) => {
      calls.push({ method: "POST", path, body, config });
      if (path === "/assistant/respond") return { data: (body as { input?: { message?: string } }).input?.message.includes("weather")
        ? { type: "unsupported", message: "This request is not supported in Compass.", sources: [] }
        : { type: "answer", message: "Try Iceland in winter.", sources: [] } };
      if (path === "/travel/places/find") return { data: { success: true, data: { place: detail } } };
      if (path === "/travel/places/images") return { data: { success: true, data: readyImages } };
      if (path.endsWith("/visits")) return { data: { success: true, data: { place: { ...place, visited: true, visitCount: 1 } } } };
      if (path === "/travel/places") return { data: { success: true, data: { place } } };
      if (path === "/travel/trips") return { data: { success: true, data: { trip } } };
      if (path.includes("/places")) return { data: { success: true, data: { trip: { ...trip, itinerary: [{ key: "relation-key", position: 1, arrivalDate: null, departureDate: null, place }] } } } };
      return { data: { success: true, data: { places: [place], trips: [trip] } } };
    },
    delete: async (path: string, config: { data: unknown }) => {
      calls.push({ method: "DELETE", path, body: config.data });
      return { data: { success: true, data: { trip } } };
    },
  },
}));

const client = await import("./travel-client");

beforeEach(() => calls.splice(0));

test("sends overview and mutations with context from the auth store", async () => {
  await client.fetchTravelOverview();
  expect(await client.findPlace("Iceland", { name: "Iceland", code: "is", continent: "Europe", lat: 64.96, lon: -19.02 })).toEqual(detail);
  await client.createPlace({ kind: "country", name: "Iceland", latitude: 64.96, longitude: -19.02, countryCode: "is", country: "Iceland", continent: "Europe", wishlist: false });
  await client.markPlaceVisited("place-key");
  await client.createTrip({ name: "North", startDate: "2027-02-01", endDate: "2027-02-08" });
  await client.addPlaceToTrip("trip-key", { placeKey: "place-key" });
  await client.removePlaceFromTrip("trip-key", "place-key");

  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
    "POST /travel/overview",
    "POST /travel/places/find",
    "POST /travel/places",
    "POST /travel/places/place-key/visits",
    "POST /travel/trips",
    "POST /travel/trips/trip-key/places",
    "DELETE /travel/trips/trip-key/places/place-key",
  ]);
  expect(calls[1]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", query: "Iceland", country: { name: "Iceland", code: "IS", continent: "Europe", lat: 64.96, lon: -19.02 } });
  expect(calls[2]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", kind: "country", name: "Iceland", latitude: 64.96, longitude: -19.02, countryCode: "IS", country: "Iceland", continent: "Europe", wishlist: false });
  expect(calls[6]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key" });
});

test("validates date ranges and identifies existing itinerary places", async () => {
  expect(() => client.createTrip({ name: "Reverse", startDate: "2027-03-10", endDate: "2027-03-01" })).toThrow("End date");
  expect(() => client.addPlaceToTrip("trip-key", { placeKey: "place-key", arrivalDate: "2027-03-10", departureDate: "2027-03-01" })).toThrow("Departure date");
  expect(client.tripContainsPlace({ ...trip, itinerary: [
    { key: "one", position: 1, arrivalDate: null, departureDate: null, place },
  ] }, "place-key")).toBe(true);
  expect(client.tripContainsPlace(trip, "place-key")).toBe(false);
});

test("strictly validates generated place details", () => {
  const { imageRequestToken: _token, ...detailWithoutToken } = detail;
  expect(client.placeDetailSchema.parse(detail)).toEqual(detail);
  expect(() => client.placeDetailSchema.parse({ ...detail, unexpected: true })).toThrow();
  expect(() => client.placeDetailSchema.parse(detailWithoutToken)).toThrow();
  expect(() => client.placeDetailSchema.parse({ ...detail, location: { ...detail.location, countryCode: "Iceland" } })).toThrow();
  expect(() => client.placeDetailSchema.parse({ ...detail, assetConcepts: assetConcepts.slice(0, 3) })).toThrow();
  expect(() => client.placeDetailSchema.parse({ ...detail, assetConcepts: [assetConcepts[0], assetConcepts[0], assetConcepts[2], assetConcepts[3]] })).toThrow();
  expect(() => client.placeDetailSchema.parse({ ...detail, assetConcepts: [assetConcepts[1], assetConcepts[0], assetConcepts[2], assetConcepts[3]] })).toThrow();
  expect(() => client.placeDetailSchema.parse({ ...detail, imageRequestToken: "x".repeat(64 * 1024 + 1) })).toThrow();
});

test("strictly parses ready data URL images and sends only the opaque token", async () => {
  expect(client.placeImagesResponseSchema.parse(readyImages)).toEqual(readyImages);
  expect(() => client.placeImagesResponseSchema.parse({ status: "processing" })).toThrow();
  expect(() => client.placeImagesResponseSchema.parse({ status: "failed" })).toThrow();
  expect(() => client.placeImagesResponseSchema.parse({ ...readyImages, images: readyImages.images.map((image, index) => index === 0 ? { ...image, url: "https://images.example/hero.webp" } : image) })).toThrow();
  expect(() => client.placeImagesResponseSchema.parse({ ...readyImages, images: [readyImages.images[1], readyImages.images[0], readyImages.images[2], readyImages.images[3]] })).toThrow();
  expect(() => client.placeImagesResponseSchema.parse({ ...readyImages, images: [...readyImages.images, readyImages.images[0]] })).toThrow();
  const oversizedUrl = `data:image/webp;base64,${"A".repeat(Math.ceil((4 * 1024 * 1024) / 3) * 4 + 4)}`;
  expect(() => client.placeImagesResponseSchema.parse({ ...readyImages, images: readyImages.images.map((image, index) => index === 0 ? { ...image, url: oversizedUrl } : image) })).toThrow();

  const controller = new AbortController();
  expect(await client.generatePlaceImages({ imageRequestToken: "opaque-image-token" }, controller.signal)).toEqual(readyImages);
  expect(calls[0]).toEqual({
    method: "POST",
    path: "/travel/places/images",
    body: { organizationKey: "org-key", scopeKey: "scope-key", imageRequestToken: "opaque-image-token" },
    config: { timeout: 5 * 60_000, signal: controller.signal },
  });
});

test("passes the query abort signal with the authoritative country selector", async () => {
  const controller = new AbortController();
  await client.findPlace("Iceland", { name: "Iceland", code: "IS", continent: "Europe", lat: 64.96, lon: -19.02 }, controller.signal);
  expect(calls[0]?.config).toEqual({ signal: controller.signal });
  expect(() => client.findPlace("Iceland", { name: "Iceland", code: "Iceland", continent: "Europe", lat: 64.96, lon: -19.02 })).toThrow();
  expect(() => client.findPlace("Iceland", { name: "Iceland", code: "IS", continent: "Europe", lat: 64.96, lon: -19.02, extra: true } as never)).toThrow();
  expect(() => client.generatePlaceImages({ imageRequestToken: "opaque-image-token", country: "Iceland" } as never)).toThrow();
  expect(() => client.generatePlaceImages({ imageRequestToken: "x".repeat(64 * 1024 + 1) })).toThrow();
});

test("asks Core through the Compass assistant surface", async () => {
  expect(await client.askTravelAssistant("Where should I go?", "request-key")).toEqual({ type: "answer", message: "Try Iceland in winter.", sources: [] });
  expect(calls[0]).toEqual({
    method: "POST",
    path: "/assistant/respond",
    body: {
      organizationKey: "org-key",
      scopeKey: "scope-key",
      input: { surface: "travel-workspace", requestKey: "request-key", message: "Where should I go?", currentNote: { title: "", content: "" } },
    },
    config: { timeout: 60_000 },
  });
});

test("parses unsupported Compass requests", async () => {
  expect(await client.askTravelAssistant("What is the weather?", "request-key")).toEqual({ type: "unsupported", message: "This request is not supported in Compass.", sources: [] });
});
