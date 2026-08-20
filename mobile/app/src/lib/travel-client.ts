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

const PLACE_IMAGE_ROLES = ["hero", "scene-1", "scene-2", "scene-3"] as const;
export const travelAssetConceptSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(4_000),
});
export const travelAssetConceptsSchema = z.tuple([
  travelAssetConceptSchema,
  travelAssetConceptSchema,
  travelAssetConceptSchema,
  travelAssetConceptSchema,
]).superRefine((concepts, context) => {
  for (const field of ["title", "prompt"] as const) {
    const normalized = concepts.map((concept) => concept[field].toLocaleLowerCase());
    if (new Set(normalized).size !== concepts.length) context.addIssue({ code: "custom", path: [], message: `Asset concept ${field}s must be distinct.` });
  }
  concepts.forEach((concept, index) => {
    if (!concept.prompt.toLocaleLowerCase().startsWith(`role: ${PLACE_IMAGE_ROLES[index]}.`)) {
      context.addIssue({ code: "custom", path: [index, "prompt"], message: `Asset concept ${index + 1} must have role ${PLACE_IMAGE_ROLES[index]}.` });
    }
  });
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
  sources: z.array(z.strictObject({ title: z.string().trim().min(1).max(500), url: z.url().startsWith("https://").max(8_000) })).max(20),
  assetConcepts: travelAssetConceptsSchema,
  imageRequestToken: z.string().min(1).max(64 * 1024),
});
export type PlaceDetail = z.infer<typeof placeDetailSchema>;

const authoritativeCountrySchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  continent: z.string().trim().min(1).max(80),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});
export type AuthoritativeCountry = z.input<typeof authoritativeCountrySchema>;

const readyPlaceImageSchema = z.strictObject({
  role: z.enum(PLACE_IMAGE_ROLES),
  status: z.literal("ready"),
  title: z.string().trim().min(1).max(160),
  url: z.string().max("data:image/webp;base64,".length + Math.ceil((4 * 1024 * 1024) / 3) * 4).regex(/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/),
  sourcePageUrl: z.url().startsWith("https://").max(8_000),
});
export const placeImagesResponseSchema = z.strictObject({
  status: z.literal("ready"),
  images: z.array(readyPlaceImageSchema).min(1).max(4).superRefine((images, context) => {
    images.forEach((image, index) => { if (image.role !== PLACE_IMAGE_ROLES[index]) context.addIssue({ code: "custom", path: [index, "role"], message: `Place image ${index + 1} must have role ${PLACE_IMAGE_ROLES[index]}.` }); });
  }),
  durationMs: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
});
export type PlaceImagesResponse = z.infer<typeof placeImagesResponseSchema>;

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
    { signal },
  ).then(({ place }) => place);
}

export function generatePlaceImages(input: z.input<typeof placeImagesInputSchema>, signal?: AbortSignal) {
  return post(
    "/travel/places/images",
    placeImagesInputSchema.parse(input),
    placeImagesResponseSchema,
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
