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
    z.object({ success: z.literal(true), data: schema }),
    z.object({ success: z.literal(false), error: z.object({ message: z.string().min(1) }) }),
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

export function fetchTravelOverview() {
  return post("/travel/overview", {}, overviewSchema);
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
