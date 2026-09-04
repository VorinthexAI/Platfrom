import { z } from "zod";

import { apiClient } from "@/lib/api-client";
import { conversationRetrievalSchema } from "@/lib/conversation-client";
import { publishUserSearchHistoryAppend } from "@/lib/user-search-history-events";
import { useAuthStore } from "@/state/auth";

export const appSearchCollectionSlugSchema = z.enum(["folders", "documents", "files", "collections", "images", "inboxes", "email-tones", "email-messages", "email-drafts", "places", "trips", "countries", "books"]);
export type AppSearchCollectionSlug = z.infer<typeof appSearchCollectionSlugSchema>;

export const appSearchInputSchema = z.strictObject({
  operation: z.enum(["search", "list"]).optional(),
  query: z.string().trim().min(1).max(500).optional(),
  collectionSlugs: z.array(appSearchCollectionSlugSchema).min(1).max(appSearchCollectionSlugSchema.options.length).refine((slugs) => new Set(slugs).size === slugs.length, "Collection slugs must be distinct."),
  recordHistory: z.boolean().default(true),
  limit: z.number().int().min(1).max(50).default(10),
  filters: z.strictObject({
    folderKey: z.string().min(1).optional(),
    includeDescendants: z.boolean().optional(),
    collectionKey: z.string().min(1).optional(),
    connectorKey: z.string().min(1).optional(),
    readState: z.enum(["read", "unread"]).optional(),
    emailFacets: z.array(z.enum(["urgent", "important", "filtered", "favorite"])).max(4).optional(),
    createdFrom: z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString()).optional(),
    createdTo: z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString()).optional(),
    tagKeys: z.array(z.string().min(1)).min(1).max(20).refine((keys) => new Set(keys).size === keys.length, "Tag keys must be distinct.").optional(),
    tagMatch: z.enum(["any", "all"]).optional(),
  }).optional(),
}).superRefine((input, context) => {
  const operation = input.operation ?? (input.query ? "search" : "list");
  if (operation === "search" && !input.query) context.addIssue({ code: "custom", path: ["query"], message: "Search requires a query." });
  if (operation === "list" && input.query) context.addIssue({ code: "custom", path: ["query"], message: "List does not accept a query." });
  if (input.filters?.tagMatch && !input.filters.tagKeys) context.addIssue({ code: "custom", path: ["filters", "tagMatch"], message: "tagMatch requires tagKeys." });
  if ((input.filters?.createdFrom || input.filters?.createdTo) && input.collectionSlugs.includes("countries")) context.addIssue({ code: "custom", path: ["filters"], message: "Countries do not have a creation date." });
  if (input.filters?.createdFrom && input.filters.createdTo && input.filters.createdFrom > input.filters.createdTo) context.addIssue({ code: "custom", path: ["filters", "createdTo"], message: "createdTo must not precede createdFrom." });
});
export type AppSearchInput = z.input<typeof appSearchInputSchema>;

export const appSearchOutputSchema = z.strictObject({
  operation: z.literal("list").optional(),
  query: z.string().optional(),
  groups: z.array(z.strictObject({ collectionSlug: appSearchCollectionSlugSchema, results: z.array(z.unknown()) })),
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
  const organizationKey = String(state.organization?.key ?? "");
  const scopeKey = String(state.scope?.key ?? "");
  if (!organizationKey || !scopeKey) throw new Error("Search is unavailable for this session.");
  return { organizationKey, scopeKey };
}

function responseError(error: unknown) {
  const failure = (error as { response?: { data?: { error?: unknown } } }).response?.data?.error;
  if (typeof failure === "string") return new Error(failure);
  if (failure && typeof failure === "object" && "message" in failure && typeof failure.message === "string") return new Error(failure.message);
  return error;
}

export async function searchApp(input: AppSearchInput, signal?: AbortSignal) {
  try {
    const parsed = appSearchInputSchema.parse(input);
    const state = useAuthStore.getState();
    const response = await apiClient.post("/app/search", { ...context(), ...parsed }, { signal, timeout: 15_000 });
    const envelope = z.discriminatedUnion("success", [
      z.strictObject({ success: z.literal(true), data: appSearchOutputSchema }),
      z.object({ success: z.literal(false), error: z.unknown() }),
    ]).parse(response.data);
    if (!envelope.success) throw new Error("App search failed.");
    if (parsed.recordHistory) publishUserSearchHistoryAppend(String(state.user?.key ?? ""));
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
