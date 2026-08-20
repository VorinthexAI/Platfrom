import { z } from "zod";

import { apiClient } from "@/lib/api-client";
import { assistantChangesSchema } from "@/lib/assistant-changes";
import { useAuthStore } from "@/state/auth";

const keySchema = z.string().min(1);

export const placeSchema = z.strictObject({
  key: keySchema,
  name: z.string().min(1),
  countryCode: z.string().length(2),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  createdAt: z.iso.datetime(),
});

export type Place = z.infer<typeof placeSchema>;

const summarySchema = z.string().trim().min(1).max(1_200);
const popularCitySchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
const popularCitiesSchema = z.array(popularCitySchema).length(10).superRefine((cities, context) => {
  if (new Set(cities.map(({ name }) => name.toLocaleLowerCase())).size !== cities.length) context.addIssue({ code: "custom", message: "Popular cities must be distinct." });
});

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
  summary: summarySchema,
  culture: z.string().trim().min(1).max(1_200),
  food: z.string().trim().min(1).max(1_200),
  whyVisit: z.string().trim().min(1).max(1_200),
  popularCities: popularCitiesSchema,
  imageRequestToken: z.string().min(1).max(64 * 1024),
});
export type PlaceDetail = z.infer<typeof placeDetailSchema>;
export const cityDetailSchema = placeDetailSchema.omit({ popularCities: true });
export type CityDetail = z.infer<typeof cityDetailSchema>;

const authoritativeCountrySchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  continent: z.string().trim().min(1).max(80),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});
export type AuthoritativeCountry = z.input<typeof authoritativeCountrySchema>;

const readyPlaceImageSchema = z.strictObject({
  status: z.literal("ready"),
  title: z.string().trim().min(1).max(160),
  url: z.string().max("data:image/webp;base64,".length + Math.ceil((4 * 1024 * 1024) / 3) * 4).regex(/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/),
  width: z.literal(1536),
  height: z.literal(864),
  mimeType: z.literal("image/webp"),
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

const overviewSchema = z.strictObject({ places: z.array(placeSchema) });
const assistantResponseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("answer"), message: z.string().min(1), sources: z.array(z.object({ documentKey: keySchema, name: z.string().min(1) })), changes: assistantChangesSchema }),
  z.object({ type: z.literal("note"), content: z.string(), message: z.string().min(1), sources: z.array(z.object({ documentKey: keySchema, name: z.string().min(1) })), changes: assistantChangesSchema }),
  z.object({ type: z.literal("unsupported"), message: z.string().min(1), sources: z.tuple([]), changes: assistantChangesSchema }),
]);
const contextSchema = z.strictObject({ organizationKey: keySchema, scopeKey: keySchema });

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
  return post("/travel/overview", {}, overviewSchema);
}

export function findPlace(query: string, country: AuthoritativeCountry, signal?: AbortSignal) {
  return post(
    "/travel/places/find",
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

export function createPlace(input: Pick<Place, "name" | "countryCode" | "latitude" | "longitude">, signal?: AbortSignal) {
  return post(
    "/travel/places",
    placeSchema.pick({ name: true, countryCode: true, latitude: true, longitude: true }).parse(input),
    z.strictObject({ place: placeSchema }),
    { timeout: 30_000, signal },
  ).then(({ place }) => place);
}

export function generatePlaceHeroImage(input: z.input<typeof placeImagesInputSchema>, signal?: AbortSignal) {
  return post(
    "/travel/places/image",
    placeImagesInputSchema.parse(input),
    placeImageResponseSchema,
    { timeout: 5 * 60_000, signal },
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
