import { z } from "zod";

import { apiClient } from "@/lib/api-client";
import { conversationRetrievalSchema } from "@/lib/conversation-client";
import { publishUserSearchHistoryAppend } from "@/lib/user-search-history-events";
import { useAuthStore } from "@/state/auth";

export const appSearchCollectionSlugSchema = z.string().min(1);
export type AppSearchCollectionSlug = "folders" | "files" | string;

export const appSearchInputSchema = z.strictObject({
  operation: z.enum(["search", "list", "count"]).optional(),
  query: z.string().trim().min(1).max(500).optional(),
  collectionSlugs: z.array(z.string().min(1)).min(1),
  recordHistory: z.boolean().default(true),
  limit: z.number().int().min(1).max(50).default(10),
  folderKey: z.string().min(1).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});
export type AppSearchInput = z.input<typeof appSearchInputSchema>;

export const appSearchOutputSchema = z.strictObject({
  query: z.string().optional(),
  groups: z.array(z.strictObject({ collectionSlug: z.string().min(1), results: z.array(z.unknown()), count: z.number().optional() })),
  retrieval: conversationRetrievalSchema.nullable().optional(),
});
export type AppSearchOutput = z.infer<typeof appSearchOutputSchema>;
export const appSearchQueryRoot = ["app-search"] as const;

export function appSearchQueryKey(contextIdentity: string, input: AppSearchInput) {
  const parsed = appSearchInputSchema.parse({ ...input, recordHistory: false });
  return [...appSearchQueryRoot, contextIdentity, parsed] as const;
}

function context() {
  const state = useAuthStore.getState();
  const scopeKey = String(state.scope?.key ?? "");
  if (!scopeKey) throw new Error("Search is unavailable for this session.");
  return { scopeKey };
}

function responseError(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ECONNABORTED" || code === "ETIMEDOUT") return new Error("Search timed out. Please try again.");
  const failure = (error as { response?: { data?: { error?: unknown } } }).response?.data?.error;
  if (typeof failure === "string") return new Error(failure);
  if (failure && typeof failure === "object" && "message" in failure && typeof failure.message === "string") return new Error(failure.message);
  return error;
}

export async function searchApp(input: AppSearchInput, signal?: AbortSignal) {
  try {
    const parsed = appSearchInputSchema.parse(input);
    const state = useAuthStore.getState();
    const { recordHistory, filters: _filters, ...body } = parsed;
    const response = await apiClient.post("/app/search", { ...context(), ...body }, { signal, timeout: 15_000 });
    const envelope = z.discriminatedUnion("success", [
      z.strictObject({ success: z.literal(true), data: appSearchOutputSchema }),
      z.object({ success: z.literal(false), error: z.unknown() }),
    ]).parse(response.data);
    if (!envelope.success) throw new Error("App search failed.");
    if (recordHistory && parsed.query) publishUserSearchHistoryAppend(String(state.user?.key ?? ""));
    return envelope.data;
  } catch (error) {
    throw responseError(error);
  }
}

export function appSearchResults<T extends z.ZodTypeAny>(output: AppSearchOutput, collectionSlug: AppSearchCollectionSlug, schema: T): z.output<T>[] {
  const group = output.groups.find((candidate) => candidate.collectionSlug === collectionSlug);
  if (!group) throw new Error(`Search response omitted ${collectionSlug}.`);
  return z.array(schema).parse(group.results);
}
