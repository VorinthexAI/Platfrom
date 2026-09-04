import { z } from "zod";

import { apiClient } from "@/lib/api-client";
import { appSearchResults, searchApp } from "@/lib/app-search-client";
import { assistantChangesSchema } from "@/lib/assistant-changes";
import { useAuthStore } from "@/state/auth";

const keySchema = z.string().min(1);

export const placeSchema = z.strictObject({
  key: keySchema,
  kind: z.enum(["country", "place"]),
  name: z.string().min(1),
  summary: z.string(),
  countryCode: z.string().length(2),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  status: z.enum(["wishlist", "visited"]),
  isFavorite: z.boolean(),
  createdAt: z.iso.datetime(),
  coverUrl: z.url().optional(),
});
const appSearchPlaceSchema = placeSchema.extend({ trips: z.array(z.strictObject({ key: keySchema, name: z.string().min(1) })).optional() });

export type Place = z.infer<typeof placeSchema>;

export const placeSearchResultSchema = z.strictObject({
  kind: z.enum(["country", "city"]),
  name: z.string().trim().min(1).max(160),
  country: z.string().trim().min(1).max(160),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  continent: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(1_200),
  lat: z.number().finite().min(-90).max(90),
  long: z.number().finite().min(-180).max(180),
});
export type PlaceSearchResult = z.infer<typeof placeSearchResultSchema>;

export const tripAttachmentSchema = z.strictObject({
  type: z.enum(["folder", "collection"]),
  key: keySchema,
});
export type TripAttachment = z.infer<typeof tripAttachmentSchema>;

export const tripSchema = z.strictObject({
  key: keySchema,
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(10_000).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  status: z.enum(["planned", "completed"]),
  isFavorite: z.boolean(),
  coverImageKey: keySchema.optional(),
  coverUrl: z.url().optional(),
  places: z.array(placeSchema).max(100),
  attachments: z.array(tripAttachmentSchema).max(100),
}).superRefine(({ places, attachments }, context) => {
  if (new Set(places.map(({ key }) => key)).size !== places.length) context.addIssue({ code: "custom", message: "Trip places must be distinct.", path: ["places"] });
  if (new Set(attachments.map(({ type, key }) => `${type}:${key}`)).size !== attachments.length) context.addIssue({ code: "custom", message: "Trip attachments must be distinct.", path: ["attachments"] });
});
export type PersistedTrip = z.infer<typeof tripSchema>;
export type Trip = Omit<PersistedTrip, "updatedAt" | "isFavorite" | "attachments"> & Partial<Pick<PersistedTrip, "updatedAt" | "isFavorite" | "attachments">>;

export const tripGuideSchema = z.strictObject({
  key: keySchema,
  tripKey: keySchema,
  name: z.string().trim().min(1).max(255),
  content: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TripGuide = z.infer<typeof tripGuideSchema>;

export const placeReferenceKindSchema = z.enum(["brief", "accommodations", "restaurants", "activities"]);
export type PlaceReferenceKind = z.infer<typeof placeReferenceKindSchema>;
export const placeReferenceSchema = z.strictObject({
  key: keySchema,
  placeKey: keySchema,
  kind: placeReferenceKindSchema,
  name: z.string().trim().min(1).max(255),
  content: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PlaceReference = z.infer<typeof placeReferenceSchema>;

export const recentPlaceSchema = z.strictObject({
  key: keySchema,
  kind: z.enum(["country", "place"]),
  name: z.string().trim().min(1),
  summary: z.string(),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  openedAt: z.iso.datetime(),
  coverUrl: z.url().optional(),
});
export type RecentPlace = z.infer<typeof recentPlaceSchema>;

const summarySchema = z.string().trim().min(1).max(1_200);
const popularCitySchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
const popularCitiesSchema = z.array(popularCitySchema).length(10).superRefine((cities, context) => {
  if (new Set(cities.map(({ name }) => name.toLocaleLowerCase())).size !== cities.length) context.addIssue({ code: "custom", message: "Popular cities must be distinct." });
});

const detailBaseSchema = z.strictObject({
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
  summary: summarySchema,
  culture: z.string().trim().min(1).max(1_200),
  food: z.string().trim().min(1).max(1_200),
  whyVisit: z.string().trim().min(1).max(1_200),
  imageRequestToken: z.string().min(1).max(64 * 1024),
});
export const placeDetailSchema = detailBaseSchema.extend({
  location: detailBaseSchema.shape.location.extend({ kind: z.literal("country") }),
  popularCities: popularCitiesSchema,
  childrenRequestToken: z.string().min(1).max(64 * 1024),
}).strict();
export type PlaceDetail = z.infer<typeof placeDetailSchema>;
export const cityDetailSchema = detailBaseSchema.extend({
  location: detailBaseSchema.shape.location.extend({ kind: z.literal("place") }),
}).strict();
export type CityDetail = z.infer<typeof cityDetailSchema>;

const authoritativeCountrySchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  continent: z.string().trim().min(1).max(80),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});
export type AuthoritativeCountry = z.input<typeof authoritativeCountrySchema>;

export const PLACE_IMAGE_PNG_MAX_BYTES = 12 * 1024 * 1024;
const pngDataUrlSchema = z.string()
  .max("data:image/png;base64,".length + Math.ceil(PLACE_IMAGE_PNG_MAX_BYTES / 3) * 4)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
  .superRefine((url, context) => {
    const encoded = url.slice("data:image/png;base64,".length);
    const decodedBytes = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
    if (decodedBytes > PLACE_IMAGE_PNG_MAX_BYTES) context.addIssue({ code: "custom", message: "Place image exceeds 12 MiB." });
  });
const readyPlaceImageSchema = z.strictObject({
  status: z.literal("ready"),
  title: z.string().trim().min(1).max(160),
  url: pngDataUrlSchema,
  width: z.literal(1536),
  height: z.literal(1024),
  mimeType: z.literal("image/png"),
});
export const placeImageResponseSchema = z.strictObject({
  status: z.literal("ready"),
  image: readyPlaceImageSchema,
  durationMs: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
});
export type PlaceImageResponse = z.infer<typeof placeImageResponseSchema>;

const placeImagesInputSchema = z.strictObject({
  imageRequestToken: z.string().min(1).max(64 * 1024),
});

export const travelOverviewSchema = z.strictObject({
  places: z.array(placeSchema),
  recentPlaces: z.array(recentPlaceSchema).max(25),
});
const assistantResponseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("answer"), message: z.string().min(1), sources: z.array(z.object({ documentKey: keySchema, name: z.string().min(1) })), changes: assistantChangesSchema }),
  z.object({ type: z.literal("note"), content: z.string(), message: z.string().min(1), sources: z.array(z.object({ documentKey: keySchema, name: z.string().min(1) })), changes: assistantChangesSchema }),
  z.object({ type: z.literal("unsupported"), message: z.string().min(1), sources: z.tuple([]), changes: assistantChangesSchema }),
]);
const contextSchema = z.strictObject({ organizationKey: keySchema, scopeKey: keySchema });
const placeSearchInputSchema = z.strictObject({ query: z.string().trim().min(2).max(500), recordHistory: z.boolean().optional() });
const createTripInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(10_000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
  placeKeys: z.array(keySchema).min(1).max(100),
}).superRefine(({ placeKeys }, context) => {
  if (new Set(placeKeys).size !== placeKeys.length) context.addIssue({ code: "custom", message: "Trip places must be distinct.", path: ["placeKeys"] });
});
export type CreateTripInput = z.input<typeof createTripInputSchema>;
const tripGuideListInputSchema = z.strictObject({ tripKey: keySchema });
const tripGuideGenerateInputSchema = z.strictObject({
  tripKey: keySchema,
  idempotencyKey: z.string().trim().min(1).max(200),
});
const placeReferenceListInputSchema = z.strictObject({ placeKey: keySchema, kind: placeReferenceKindSchema });
const placeReferenceGenerateInputSchema = z.strictObject({
  placeKey: keySchema,
  kind: placeReferenceKindSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
});
const updateTripInputSchema = z.strictObject({
  tripKey: keySchema,
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().min(1).max(10_000).nullable().optional(),
  coverImageKey: keySchema.nullable().optional(),
  isFavorite: z.boolean().optional(),
  status: z.enum(["planned", "completed"]).optional(),
  placeKeys: z.array(keySchema).min(1).max(100).optional(),
}).superRefine((input, context) => {
  if (input.name === undefined && input.description === undefined && input.coverImageKey === undefined && input.isFavorite === undefined && input.status === undefined && input.placeKeys === undefined) {
    context.addIssue({ code: "custom", message: "At least one trip field must be updated." });
  }
  if (input.placeKeys && new Set(input.placeKeys).size !== input.placeKeys.length) context.addIssue({ code: "custom", message: "Trip places must be distinct.", path: ["placeKeys"] });
});
export type UpdateTripInput = z.input<typeof updateTripInputSchema>;
const updatePlaceInputSchema = z.strictObject({
  placeKey: keySchema,
  status: z.enum(["wishlist", "visited"]).optional(),
  isFavorite: z.boolean().optional(),
}).superRefine((input, context) => {
  if (input.status === undefined && input.isFavorite === undefined) context.addIssue({ code: "custom", message: "At least one place field must be updated." });
});
export type UpdatePlaceInput = z.input<typeof updatePlaceInputSchema>;
const deletePlaceInputSchema = z.strictObject({ placeKey: keySchema });
const setTripAttachmentsInputSchema = z.strictObject({
  tripKey: keySchema,
  attachments: z.array(tripAttachmentSchema).max(100),
}).superRefine(({ attachments }, context) => {
  if (new Set(attachments.map(({ type, key }) => `${type}:${key}`)).size !== attachments.length) context.addIssue({ code: "custom", message: "Trip attachments must be distinct.", path: ["attachments"] });
});
export type SetTripAttachmentsInput = z.input<typeof setTripAttachmentsInputSchema>;
const countrySearchInputSchema = z.strictObject({ organizationKey: keySchema, query: z.string().trim().min(1).max(200) });
export const countrySearchResultSchema = z.strictObject({
  country: z.strictObject({
    name: z.string().trim().min(1).max(160),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  }).nullable(),
});
export type CountrySearchResult = z.infer<typeof countrySearchResultSchema>["country"];

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

async function post<T>(path: string, body: Record<string, unknown>, schema: z.ZodType<T>, config?: { timeout?: number; signal?: AbortSignal }) {
  try {
    const response = await apiClient.post(path, { ...getTravelContext(), ...body }, config);
    return unwrap(response.data, schema);
  } catch (error) {
    throw responseError(error);
  }
}

export function fetchTravelOverview() {
  return post("/travel/overview", {}, travelOverviewSchema);
}

export async function findPlaces(query: string, signal?: AbortSignal) {
  return post(
    "/travel/places/find",
    placeSearchInputSchema.parse({ query }),
    z.strictObject({ results: z.array(placeSearchResultSchema).min(1).max(5) }),
    { timeout: 30_000, signal },
  ).then(({ results }) => results);
}

export function listTrips(signal?: AbortSignal) {
  return post(
    "/travel/trips/list",
    {},
    z.strictObject({ trips: z.array(tripSchema) }),
    { timeout: 30_000, signal },
  ).then(({ trips }) => trips);
}

export async function listTripGuides(tripKey: string, signal?: AbortSignal) {
  const parsed = tripGuideListInputSchema.parse({ tripKey });
  const guides = await post(
    "/travel/trips/guides/list",
    parsed,
    z.strictObject({ guides: z.array(tripGuideSchema).max(100) }),
    { timeout: 30_000, signal },
  ).then(({ guides }) => guides);
  if (guides.some((guide) => guide.tripKey !== parsed.tripKey)) throw new Error("The travel guide response did not match this trip.");
  return guides;
}

export async function generateTripGuide(tripKey: string, idempotencyKey: string, signal?: AbortSignal) {
  const parsed = tripGuideGenerateInputSchema.parse({ tripKey, idempotencyKey });
  const guide = await post(
    "/travel/trips/guides/generate",
    parsed,
    z.strictObject({ guide: tripGuideSchema }),
    { timeout: 60_000, signal },
  ).then(({ guide }) => guide);
  if (guide.tripKey !== parsed.tripKey) throw new Error("The generated travel guide did not match this trip.");
  return guide;
}

export async function listPlaceReferences(placeKey: string, kind: PlaceReferenceKind, signal?: AbortSignal) {
  const parsed = placeReferenceListInputSchema.parse({ placeKey, kind });
  const references = await post(
    "/travel/places/references/list",
    parsed,
    z.strictObject({ references: z.array(placeReferenceSchema).max(100) }),
    { timeout: 30_000, signal },
  ).then(({ references }) => references);
  if (references.some((reference) => reference.placeKey !== parsed.placeKey || reference.kind !== parsed.kind)) throw new Error("The place reference response did not match this place and kind.");
  return references;
}

export async function generatePlaceReference(placeKey: string, kind: PlaceReferenceKind, idempotencyKey: string, signal?: AbortSignal) {
  const parsed = placeReferenceGenerateInputSchema.parse({ placeKey, kind, idempotencyKey });
  const reference = await post(
    "/travel/places/references/generate",
    parsed,
    z.strictObject({ reference: placeReferenceSchema }),
    { timeout: 60_000, signal },
  ).then(({ reference }) => reference);
  if (reference.placeKey !== parsed.placeKey || reference.kind !== parsed.kind) throw new Error("The generated place reference did not match this place and kind.");
  return reference;
}

function savedTravelSearchInput(query: string, recordHistory: boolean, tagKeys: string[]) {
  const normalizedQuery = z.string().trim().max(500).parse(query);
  const normalizedTagKeys = z.array(keySchema).max(20).refine((keys) => new Set(keys).size === keys.length, "Tag keys must be distinct.").parse([...tagKeys].sort());
  if (!normalizedQuery && !normalizedTagKeys.length) throw new Error("Saved travel search requires a query or tags.");
  if (normalizedQuery.length === 1) throw new Error("Saved travel search queries must contain at least two characters.");
  return {
    ...(normalizedQuery ? { query: normalizedQuery } : { operation: "list" as const }),
    recordHistory,
    ...(normalizedTagKeys.length ? { filters: { tagKeys: normalizedTagKeys, tagMatch: "all" as const } } : {}),
  };
}

export async function searchPlaces(query: string, signal?: AbortSignal, recordHistory = true, tagKeys: string[] = []) {
  const output = await searchApp({ ...savedTravelSearchInput(query, recordHistory, tagKeys), collectionSlugs: ["places"], limit: 50 }, signal);
  return appSearchResults(output, "places", appSearchPlaceSchema).map(({ trips: _trips, ...place }) => place);
}

export function searchTrips(query: string, signal?: AbortSignal, recordHistory = true, tagKeys: string[] = []) {
  return searchApp({ ...savedTravelSearchInput(query, recordHistory, tagKeys), collectionSlugs: ["trips"], limit: 50 }, signal).then((output) => appSearchResults(output, "trips", tripSchema));
}

export async function createTrip(input: CreateTripInput, signal?: AbortSignal) {
  return post(
    "/travel/trips",
    createTripInputSchema.parse(input),
    z.strictObject({ trip: tripSchema }),
    { timeout: 30_000, signal },
  ).then(({ trip }) => trip);
}

export async function updateTrip(input: UpdateTripInput, signal?: AbortSignal) {
  return post(
    "/travel/trips/update",
    updateTripInputSchema.parse(input),
    z.strictObject({ trip: tripSchema }),
    { timeout: 30_000, signal },
  ).then(({ trip }) => trip);
}

export async function updatePlace(input: UpdatePlaceInput, signal?: AbortSignal) {
  return post(
    "/travel/places/update",
    updatePlaceInputSchema.parse(input),
    z.strictObject({ place: placeSchema }),
    { timeout: 30_000, signal },
  ).then(({ place }) => place);
}

export async function deletePlace(placeKey: string, signal?: AbortSignal) {
  return post(
    "/travel/places/delete",
    deletePlaceInputSchema.parse({ placeKey }),
    z.strictObject({ placeKey: keySchema }),
    { timeout: 30_000, signal },
  );
}

export async function deleteTrip(tripKey: string, signal?: AbortSignal) {
  return post(
    "/travel/trips/delete",
    z.strictObject({ tripKey: keySchema }).parse({ tripKey }),
    z.strictObject({ tripKey: keySchema }),
    { timeout: 30_000, signal },
  );
}

export async function setTripAttachments(input: SetTripAttachmentsInput, signal?: AbortSignal) {
  return post(
    "/travel/trips/attachments/set",
    setTripAttachmentsInputSchema.parse(input),
    z.strictObject({ trip: tripSchema }),
    { timeout: 30_000, signal },
  ).then(({ trip }) => trip);
}

export function openPlace(name: string, countryCode: string, signal?: AbortSignal) {
  return post(
    "/travel/places/open",
    z.strictObject({ name: z.string().trim().min(1).max(160), countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/) }).parse({ name, countryCode }),
    z.strictObject({ place: recentPlaceSchema }),
    { timeout: 30_000, signal },
  ).then(({ place }) => place);
}

export function findPlace(query: string, country: AuthoritativeCountry, signal?: AbortSignal) {
  return post(
    "/travel/places/guide",
    z.strictObject({ query: z.string().trim().min(2).max(200), country: authoritativeCountrySchema }).parse({ query, country }),
    z.strictObject({ place: placeDetailSchema }),
    { timeout: 30_000, signal },
  ).then(({ place }) => place);
}

export function findCity(city: string, country: AuthoritativeCountry, signal?: AbortSignal) {
  return post(
    "/travel/cities/find",
    z.strictObject({ city: z.string().trim().min(1).max(160), country: authoritativeCountrySchema }).parse({ city, country }),
    z.strictObject({ city: cityDetailSchema }),
    { timeout: 30_000, signal },
  ).then(({ city: detail }) => detail);
}

export function findPlaceChildren(childrenRequestToken: string, signal?: AbortSignal) {
  return post(
    "/travel/places/children/find",
    z.strictObject({ childrenRequestToken: z.string().min(1).max(64 * 1024) }).parse({ childrenRequestToken }),
    z.strictObject({ cities: z.array(cityDetailSchema).length(10) }),
    { timeout: 30_000, signal },
  ).then(({ cities }) => cities);
}

export async function searchCountries(query: string, signal?: AbortSignal) {
  countrySearchInputSchema.parse({ organizationKey: getTravelContext().organizationKey, query });
  const output = await searchApp({ query, collectionSlugs: ["countries"], limit: 1 }, signal);
  return appSearchResults(output, "countries", countrySearchResultSchema.shape.country.unwrap()).at(0) ?? null;
}

const createPlaceInputSchema = placeSchema.pick({ name: true, summary: true, countryCode: true, latitude: true, longitude: true }).extend({
  summary: summarySchema,
  imageRequestToken: z.string().min(1).max(64 * 1024),
}).strict();
export type CreatePlaceInput = z.input<typeof createPlaceInputSchema>;

export function createPlace(input: CreatePlaceInput, signal?: AbortSignal) {
  return post(
    "/travel/places",
    createPlaceInputSchema.parse(input),
    z.strictObject({ place: placeSchema }),
    { timeout: 30_000, signal },
  ).then(({ place }) => place);
}

export function generatePlaceHeroImage(input: z.input<typeof placeImagesInputSchema>, signal?: AbortSignal) {
  return post(
    "/travel/places/image",
    placeImagesInputSchema.parse(input),
    placeImageResponseSchema,
    { timeout: 15_000, signal },
  );
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
