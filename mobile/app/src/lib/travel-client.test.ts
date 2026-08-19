import { beforeEach, expect, mock, test } from "bun:test";

const calls: { method: string; path: string; body: unknown; config?: unknown }[] = [];
const authState = { organization: { key: "org-key" }, scope: { key: "scope-key" } };
const timestamp = "2026-08-11T10:00:00.000Z";
const place = { key: "place-key", name: "Reykjavik", countryCode: "IS", latitude: 64.15, longitude: -21.94, createdAt: timestamp };

mock.module("@/state/auth", () => ({ useAuthStore: { getState: () => authState } }));
mock.module("./api-client", () => ({
  apiClient: {
    post: async (path: string, body: unknown, config?: unknown) => {
      calls.push({ method: "POST", path, body, config });
      if (path === "/assistant/respond") return { data: (body as { input?: { message?: string } }).input?.message.includes("weather")
        ? { type: "unsupported", message: "This request is not supported in Compass.", sources: [] }
        : { type: "answer", message: "Try Reykjavik in winter.", sources: [] } };
      return { data: { success: true, data: { places: [place] } } };
    },
  },
}));

const client = await import("./travel-client");

beforeEach(() => calls.splice(0));

test("sends the saved-city overview with session context", async () => {
  expect(await client.fetchTravelOverview()).toEqual({ places: [place] });

  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
    "POST /travel/overview",
  ]);
  expect(calls[0]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key" });
});

test("accepts only the saved-city response fields", () => {
  expect(client.placeSchema.parse(place)).toEqual(place);
  expect(client.placeSchema.safeParse({ ...place, visited: false }).success).toBe(false);
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
