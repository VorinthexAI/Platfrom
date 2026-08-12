import { beforeEach, expect, mock, test } from "bun:test";

const calls: { method: string; path: string; body: unknown }[] = [];
const authState = { organization: { key: "org-key" }, scope: { key: "scope-key" } };
const timestamp = "2026-08-11T10:00:00.000Z";
const place = { key: "place-key", kind: "country", name: "Iceland", latitude: 64.96, longitude: -19.02, countryCode: "IS", country: "Iceland", continent: "Europe", city: null, wishlist: false, visited: false, createdAt: timestamp, updatedAt: timestamp };
const trip = { key: "trip-key", name: "North", description: null, startDate: null, endDate: null, itinerary: [], createdAt: timestamp, updatedAt: timestamp };

mock.module("@/state/auth", () => ({ useAuthStore: { getState: () => authState } }));
mock.module("./api-client", () => ({
  apiClient: {
    post: async (path: string, body: unknown) => {
      calls.push({ method: "POST", path, body });
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
  await client.createPlace({ kind: "country", name: "Iceland", latitude: 64.96, longitude: -19.02, countryCode: "is", country: "Iceland", continent: "Europe", wishlist: false });
  await client.markPlaceVisited("place-key");
  await client.createTrip({ name: "North", startDate: "2027-02-01", endDate: "2027-02-08" });
  await client.addPlaceToTrip("trip-key", { placeKey: "place-key" });
  await client.removePlaceFromTrip("trip-key", "place-key");

  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
    "POST /travel/overview",
    "POST /travel/places",
    "POST /travel/places/place-key/visits",
    "POST /travel/trips",
    "POST /travel/trips/trip-key/places",
    "DELETE /travel/trips/trip-key/places/place-key",
  ]);
  expect(calls[1]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", kind: "country", name: "Iceland", latitude: 64.96, longitude: -19.02, countryCode: "IS", country: "Iceland", continent: "Europe", wishlist: false });
  expect(calls[5]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key" });
});

test("validates date ranges and identifies existing itinerary places", async () => {
  expect(() => client.createTrip({ name: "Reverse", startDate: "2027-03-10", endDate: "2027-03-01" })).toThrow("End date");
  expect(() => client.addPlaceToTrip("trip-key", { placeKey: "place-key", arrivalDate: "2027-03-10", departureDate: "2027-03-01" })).toThrow("Departure date");
  expect(client.tripContainsPlace({ ...trip, itinerary: [
    { key: "one", position: 1, arrivalDate: null, departureDate: null, place },
  ] }, "place-key")).toBe(true);
  expect(client.tripContainsPlace(trip, "place-key")).toBe(false);
});
