import { beforeEach, expect, mock, test } from "bun:test";

const calls: { method: string; path: string; body: unknown; config?: unknown }[] = [];
const authState = { organization: { key: "org-key" }, scope: { key: "scope-key" } };
const timestamp = "2026-08-11T10:00:00.000Z";
const place = { key: "place-key", name: "Reykjavik", countryCode: "IS", latitude: 64.15, longitude: -21.94, createdAt: timestamp };
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
  images: [
    { role: "hero" as const, status: "ready" as const, title: "Overview", url: "data:image/webp;base64,aW1hZ2Uw", width: 864 as const, height: 1536 as const, mimeType: "image/webp" as const },
    { role: "scene-1" as const, status: "ready" as const, title: "Coast", url: "data:image/webp;base64,aW1hZ2Ux", width: 864 as const, height: 1536 as const, mimeType: "image/webp" as const },
    { role: "scene-2" as const, status: "ready" as const, title: "City", url: "data:image/webp;base64,aW1hZ2Uy", width: 864 as const, height: 1536 as const, mimeType: "image/webp" as const },
    { role: "scene-3" as const, status: "ready" as const, title: "Garden", url: "data:image/webp;base64,aW1hZ2Uz", width: 864 as const, height: 1536 as const, mimeType: "image/webp" as const },
  ],
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
        : { type: "answer", message: "Try Reykjavik in winter.", sources: [] } };
      if (path === "/travel/places/find") return { data: { success: true, data: { place: detail } } };
      if (path === "/travel/places/images") return { data: { success: true, data: readyImages } };
      return { data: { success: true, data: { places: [place] } } };
    },
  },
}));

const client = await import("./travel-client");

beforeEach(() => calls.splice(0));

test("sends the saved-city overview with session context", async () => {
  expect(await client.fetchTravelOverview()).toEqual({ places: [place] });
  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual(["POST /travel/overview"]);
  expect(calls[0]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key" });
});

test("accepts only the saved-city response fields", () => {
  expect(client.placeSchema.parse(place)).toEqual(place);
  expect(client.placeSchema.safeParse({ ...place, visited: false }).success).toBe(false);
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
  expect(calls[0]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", query: "Iceland", country: { name: "Iceland", code: "IS", continent: "Europe", lat: 64.96, lon: -19.02 } });
  expect(calls[0]?.config).toEqual({ signal: controller.signal });
  expect(() => client.findPlace("Iceland", { name: "Iceland", code: "Iceland", continent: "Europe", lat: 64.96, lon: -19.02 })).toThrow();
  expect(() => client.findPlace("Iceland", { name: "Iceland", code: "IS", continent: "Europe", lat: 64.96, lon: -19.02, extra: true } as never)).toThrow();
  expect(() => client.generatePlaceImages({ imageRequestToken: "opaque-image-token", country: "Iceland" } as never)).toThrow();
  expect(() => client.generatePlaceImages({ imageRequestToken: "x".repeat(64 * 1024 + 1) })).toThrow();
});

test("asks Core through the Compass assistant surface", async () => {
  expect(await client.askTravelAssistant("Which cities have I saved?", "request-key")).toEqual({ type: "answer", message: "Try Reykjavik in winter.", sources: [] });
  expect(calls[0]).toEqual({
    method: "POST",
    path: "/assistant/respond",
    body: {
      organizationKey: "org-key",
      scopeKey: "scope-key",
      input: { surface: "travel-workspace", requestKey: "request-key", message: "Which cities have I saved?", currentNote: { title: "", content: "" } },
    },
    config: { timeout: 60_000 },
  });
});

test("parses unsupported Compass requests", async () => {
  expect(await client.askTravelAssistant("What is the weather?", "request-key")).toEqual({ type: "unsupported", message: "This request is not supported in Compass.", sources: [] });
});
