import { z } from "zod";

import { apiClient } from "@/lib/api-client";
import { assistantChangesSchema } from "@/lib/assistant-changes";
import { useAuthStore } from "@/state/auth";

const keySchema = z.string().min(1);
const dateSchema = z.iso.date();

export const placeSchema = z.object({
  key: keySchema,
  kind: z.enum(["country", "place"]),
  name: z.string().min(1),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  countryCode: z.string().length(2).nullish(),
  country: z.string().nullish(),
  continent: z.string().nullish(),
  city: z.string().nullish(),
  wishlist: z.boolean(),
  visited: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const itineraryPlaceSchema = z.object({
  key: keySchema,
  position: z.number().int().positive(),
  arrivalDate: dateSchema.nullish(),
  departureDate: dateSchema.nullish(),
  place: placeSchema,
});

export const tripSchema = z.object({
  key: keySchema,
  name: z.string().min(1),
  description: z.string().nullish(),
  startDate: dateSchema.nullish(),
  endDate: dateSchema.nullish(),
  itinerary: z.array(itineraryPlaceSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Place = z.infer<typeof placeSchema>;
export type ItineraryPlace = z.infer<typeof itineraryPlaceSchema>;
export type Trip = z.infer<typeof tripSchema>;

export const placeDetailSchema = z.strictObject({
  location: z.strictObject({
    kind: z.enum(["country", "place"]),
    name: z.string().trim().min(1).max(160),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    country: z.string().trim().min(1).max(160),
    continent: z.string().trim().min(1).max(80),
    region: z.string().trim().min(1).max(160).nullable(),
    city: z.string().trim().min(1).max(160).nullable(),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  }),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(1_500),
  facts: z.array(z.strictObject({ label: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(300) })).min(3).max(10),
  highlights: z.array(z.strictObject({ title: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(500) })).min(1).max(8),
  practicalInfo: z.strictObject({
    bestTimeToVisit: z.string().trim().min(1).max(500),
    languages: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
    currency: z.string().trim().min(1).max(120),
    timeZone: z.string().trim().min(1).max(120),
    safety: z.string().trim().min(1).max(600),
    entryRequirements: z.string().trim().min(1).max(800),
  }),
});
export type PlaceDetail = z.infer<typeof placeDetailSchema>;

const overviewSchema = z.object({ places: z.array(placeSchema), trips: z.array(tripSchema) });
const assistantResponseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("answer"), message: z.string().min(1), sources: z.array(z.object({ documentKey: keySchema, name: z.string().min(1) })), changes: assistantChangesSchema }),
  z.object({ type: z.literal("note"), content: z.string(), message: z.string().min(1), sources: z.array(z.object({ documentKey: keySchema, name: z.string().min(1) })), changes: assistantChangesSchema }),
  z.object({ type: z.literal("unsupported"), message: z.string().min(1), sources: z.tuple([]), changes: assistantChangesSchema }),
]);
const contextSchema = z.strictObject({ organizationKey: keySchema, scopeKey: keySchema });
const createPlaceSchema = z.strictObject({
  name: z.string().trim().min(1),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  kind: z.enum(["country", "place"]),
  countryCode: z.string().trim().toUpperCase().length(2),
  country: z.string().trim().min(1).optional(),
  continent: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  wishlist: z.boolean(),
});
const createTripSchema = z.strictObject({
  name: z.string().trim().min(1),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
}).refine(({ startDate, endDate }) => !startDate || !endDate || endDate >= startDate, {
  message: "End date must not precede start date.",
  path: ["endDate"],
});
const addTripPlaceSchema = z.strictObject({
  placeKey: keySchema,
  arrivalDate: dateSchema.optional(),
  departureDate: dateSchema.optional(),
}).refine(({ arrivalDate, departureDate }) => !arrivalDate || !departureDate || departureDate >= arrivalDate, {
  message: "Departure date must not precede arrival date.",
  path: ["departureDate"],
});

type ApiResponse<T> = { success: true; data: T } | { success: false; error: { message: string } };

function recordKey(value: Record<string, unknown> | null) {
  return typeof value?.key === "string" ? value.key : "";
}

export function getTravelContext() {
  const state = useAuthStore.getState();
  const parsed = contextSchema.safeParse({
    organizationKey: recordKey(state.organization),
    scopeKey: recordKey(state.scope),
  });
  if (!parsed.success) throw new Error("Places are unavailable for this session.");
  return parsed.data;
}

function unwrap<T>(value: unknown, schema: z.ZodType<T>): T {
  const response = z.discriminatedUnion("success", [
    z.strictObject({ success: z.literal(true), data: schema }),
    z.strictObject({ success: z.literal(false), error: z.strictObject({ message: z.string().min(1) }) }),
  ]).parse(value);
  if (!response.success) throw new Error(response.error.message);
  return response.data;
}

function responseError(error: unknown) {
  const failure = (error as { response?: { data?: ApiResponse<unknown> } }).response?.data;
  return failure && !failure.success && typeof failure.error?.message === "string"
    ? new Error(failure.error.message)
    : error;
}

async function post<T>(path: string, body: Record<string, unknown>, schema: z.ZodType<T>) {
  try {
    const response = await apiClient.post(path, { ...getTravelContext(), ...body });
    return unwrap(response.data, schema);
  } catch (error) {
    throw responseError(error);
  }
}

async function remove<T>(path: string, schema: z.ZodType<T>) {
  try {
    const response = await apiClient.delete(path, { data: getTravelContext() });
    return unwrap(response.data, schema);
  } catch (error) {
    throw responseError(error);
  }
}

export function fetchTravelOverview() {
  return post("/travel/overview", {}, overviewSchema);
}

export function findPlace(query: string) {
  return post(
    "/travel/places/find",
    z.strictObject({ query: z.string().trim().min(2).max(200) }).parse({ query }),
    z.strictObject({ place: placeDetailSchema }),
  ).then(({ place }) => place);
}

export function createPlace(input: z.input<typeof createPlaceSchema>) {
  return post("/travel/places", createPlaceSchema.parse(input), z.object({ place: placeSchema })).then(({ place }) => place);
}

export function markPlaceVisited(placeKey: string) {
  return post(`/travel/places/${keySchema.parse(placeKey)}/visits`, {}, z.object({ place: placeSchema })).then(({ place }) => place);
}

export function createTrip(input: z.input<typeof createTripSchema>) {
  return post("/travel/trips", createTripSchema.parse(input), z.object({ trip: tripSchema })).then(({ trip }) => trip);
}

export function addPlaceToTrip(tripKey: string, input: z.input<typeof addTripPlaceSchema>) {
  return post(`/travel/trips/${keySchema.parse(tripKey)}/places`, addTripPlaceSchema.parse(input), z.object({ trip: tripSchema })).then(({ trip }) => trip);
}

export function removePlaceFromTrip(tripKey: string, placeKey: string) {
  return remove(`/travel/trips/${keySchema.parse(tripKey)}/places/${keySchema.parse(placeKey)}`, z.object({ trip: tripSchema })).then(({ trip }) => trip);
}

export function tripContainsPlace(trip: Trip, placeKey: string) {
  return trip.itinerary.some(({ place }) => place.key === placeKey);
}

export async function askTravelAssistant(message: string, requestKey: string) {
  const { organizationKey, scopeKey } = getTravelContext();
  try {
    const response = await apiClient.post("/assistant/respond", {
      organizationKey,
      scopeKey,
      input: {
        surface: "travel-workspace",
        requestKey: z.string().trim().min(1).max(180).parse(requestKey),
        message: z.string().trim().min(1).max(8_000).parse(message),
        currentNote: { title: "", content: "" },
      },
    }, { timeout: 60_000 });
    return assistantResponseSchema.parse(response.data);
  } catch (error) {
    throw responseError(error);
  }
}
