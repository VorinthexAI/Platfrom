import { z } from "zod";

import { apiClient } from "@/lib/api-client";
import { assistantChangesSchema } from "@/lib/assistant-changes";
import { publicApiClient } from "@/lib/public-api-client";
import { useAuthStore } from "@/state/auth";

const keySchema = z.string().trim().min(1);
const contextSchema = z.strictObject({ organizationKey: keySchema, scopeKey: keySchema });
export const requestedChapterCountSchema = z.union([z.literal(10), z.literal(25), z.literal(50)]);
export const extensionChapterCountSchema = z.union([z.literal(1), z.literal(3), z.literal(5)]);
export const bookStatusSchema = z.enum(["queued", "researching", "planning", "writing", "narrating", "finalizing", "failed", "ready", "cancelled"]);
export const narratorVoiceSchema = z.strictObject({
  key: z.enum(["calm", "clear", "warm"]),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  previewUrl: z.url().optional(),
});

export const bookSchema = z.strictObject({
  key: keySchema,
  title: z.string().min(1),
  subtitle: z.string().min(1),
  description: z.string().min(1),
  status: bookStatusSchema,
  isFavorite: z.boolean(),
  coverUrl: z.url().optional(),
  narrator: narratorVoiceSchema.optional(),
  estimatedMinutes: z.number().int().nonnegative(),
  chapterCount: z.number().int().nonnegative(),
  progressPercent: z.number().min(0).max(100),
  generationProgressPercent: z.number().min(0).max(100).optional(),
  failureMessage: z.string().min(1).optional(),
  currentChapterKey: keySchema.optional(),
});

export const bookChapterSchema = z.strictObject({
  key: keySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  content: z.string().min(1).optional(),
  position: z.number().int().positive(),
  estimatedMinutes: z.number().int().nonnegative().optional(),
  imageUrl: z.url().optional(),
  audioUrl: z.url().optional(),
  audioDurationSeconds: z.number().int().nonnegative().optional(),
  progressSeconds: z.number().nonnegative(),
  isCompleted: z.boolean(),
});

const overviewRequestSchema = contextSchema;
export const createBookRequestSchema = contextSchema.extend({
  generationRequestKey: z.string().trim().min(1).max(200),
  topic: z.string().trim().min(3).max(2_000),
  goal: z.string().trim().min(3).max(2_000),
  currentKnowledge: z.string().trim().max(2_000),
  chapterCount: requestedChapterCountSchema,
  language: z.string().trim().min(2).max(100),
  writingTone: z.string().trim().min(2).max(200),
  narratorVoiceKey: narratorVoiceSchema.shape.key,
  narrationPace: z.number().min(0.75).max(2),
  archiveDocumentKeys: z.array(keySchema).max(50),
  chapterImages: z.boolean(),
  additionalInstructions: z.string().trim().max(12_000).optional(),
});
const detailRequestSchema = contextSchema;
const mutationRequestSchema = contextSchema.extend({ requestKey: z.string().trim().min(1).max(200) });
const favoriteRequestSchema = contextSchema.extend({ isFavorite: z.boolean() });
export const bookShareDetailRequestSchema = contextSchema;
export const bookShareUpdateRequestSchema = contextSchema.extend({ active: z.boolean() });
export const publicBookShareReadRequestSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const chapterProgressRequestSchema = contextSchema.extend({
  progressSeconds: z.number().int().nonnegative(),
  isCompleted: z.boolean(),
});
export const bookTopicSuggestionsRequestSchema = contextSchema.extend({ excludeTopics: z.array(z.string().trim().min(3).max(160)).max(40).default([]) });
export const bookTopicSuggestionsResponseSchema = z.strictObject({ topics: z.array(z.string().trim().min(3).max(160)).length(10).superRefine((topics, context) => {
  if (new Set(topics.map((topic) => topic.toLocaleLowerCase())).size !== topics.length) context.addIssue({ code: "custom", message: "Topics must be unique." });
}) });
export const bookGoalSuggestionsRequestSchema = contextSchema.extend({ topic: z.string().trim().min(3).max(2_000), excludeGoals: z.array(z.string().trim().min(3).max(160)).max(40).default([]) });
export const bookGoalSuggestionsResponseSchema = z.strictObject({ goals: z.array(z.string().trim().min(3).max(160)).length(10).superRefine((goals, context) => {
  if (new Set(goals.map((goal) => goal.toLocaleLowerCase())).size !== goals.length) context.addIssue({ code: "custom", message: "Goals must be unique." });
}) });
export const bookExtensionPreviewRequestSchema = contextSchema.extend({ chapterCount: extensionChapterCountSchema });
export const bookExtensionPreviewResponseSchema = z.strictObject({ titles: z.array(z.string().trim().min(1)) });
export const bookExtensionRequestSchema = contextSchema.extend({
  chapterCount: extensionChapterCountSchema,
  titles: z.array(z.string().trim().min(1)),
  requestKey: z.string().trim().min(1).max(200),
}).superRefine((input, context) => {
  if (input.titles.length !== input.chapterCount) context.addIssue({ code: "custom", path: ["titles"], message: "A title is required for every extension chapter." });
});

const overviewResponseSchema = z.strictObject({ books: z.array(bookSchema) });
const detailResponseSchema = z.strictObject({ book: bookSchema, chapters: z.array(bookChapterSchema) });
export const bookShareSchema = z.strictObject({
  key: keySchema,
  url: z.url(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const publicBookShareAccessSchema = z.strictObject({ status: z.enum(["active", "inactive"]) });
const progressResponseSchema = z.strictObject({ chapter: bookChapterSchema, book: bookSchema });
const assistantResponseSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("answer"), message: z.string().min(1), sources: z.array(z.strictObject({ documentKey: keySchema, name: z.string().min(1) })), changes: assistantChangesSchema }),
  z.strictObject({ type: z.literal("unsupported"), message: z.string().min(1), sources: z.tuple([]), changes: assistantChangesSchema }),
]);
const failureSchema = z.strictObject({ success: z.literal(false), error: z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  tool: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  retryable: z.boolean().optional(),
  resourceKey: keySchema.optional(),
}) });

export type Book = z.infer<typeof bookSchema>;
export type BookChapter = z.infer<typeof bookChapterSchema>;
export type BookDetail = z.infer<typeof detailResponseSchema>;
export type BookShare = z.infer<typeof bookShareSchema>;
export type CreateBookInput = Omit<z.input<typeof createBookRequestSchema>, "organizationKey" | "scopeKey" | "generationRequestKey">;
export type BookStatus = z.infer<typeof bookStatusSchema>;
export type NarratorVoice = z.infer<typeof narratorVoiceSchema>;
export type ExtensionChapterCount = z.infer<typeof extensionChapterCountSchema>;
export type BookExtensionPreview = z.infer<typeof bookExtensionPreviewResponseSchema>;
export type BookExtensionInput = Omit<z.input<typeof bookExtensionRequestSchema>, "organizationKey" | "scopeKey">;

export class BookClientError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) {
    super(message);
    this.name = "BookClientError";
  }
}

function recordKey(value: Record<string, unknown> | null) {
  return typeof value?.key === "string" ? value.key : "";
}

export function getBooksContext() {
  const state = useAuthStore.getState();
  const parsed = contextSchema.safeParse({ organizationKey: recordKey(state.organization), scopeKey: recordKey(state.scope) });
  if (!parsed.success) throw new Error("Books are unavailable for this session.");
  return parsed.data;
}

function unwrap<T>(value: unknown, schema: z.ZodType<T>) {
  const response = z.discriminatedUnion("success", [z.strictObject({ success: z.literal(true), data: schema }), failureSchema]).parse(value);
  if (!response.success) throw new BookClientError(response.error.code, response.error.message);
  return response.data;
}

function responseError(error: unknown) {
  const parsed = failureSchema.safeParse((error as { response?: { data?: unknown } }).response?.data);
  const status = (error as { response?: { status?: unknown } }).response?.status;
  return parsed.success ? new BookClientError(parsed.data.error.code, parsed.data.error.message, typeof status === "number" ? status : undefined) : error;
}

async function request<T>(method: "post" | "patch" | "delete", path: string, body: unknown, requestSchema: z.ZodType, responseSchema: z.ZodType<T>, timeout?: number) {
  try {
    const payload = requestSchema.parse({ ...getBooksContext(), ...(body as Record<string, unknown>) });
    const config = timeout ? { timeout } : undefined;
    const response = method === "delete" ? await apiClient.delete(path, { ...config, data: payload }) : await apiClient[method](path, payload, config);
    return unwrap(response.data, responseSchema);
  } catch (error) {
    throw responseError(error);
  }
}

export function fetchBooksOverview() { return request("post", "/books/overview", {}, overviewRequestSchema, overviewResponseSchema); }
export function suggestBookTopics(excludeTopics: string[] = []) { return request("post", "/books/topic-suggestions", { excludeTopics }, bookTopicSuggestionsRequestSchema, bookTopicSuggestionsResponseSchema, 30_000); }
export function suggestBookGoals(topic: string, excludeGoals: string[] = []) { return request("post", "/books/goal-suggestions", { topic, excludeGoals }, bookGoalSuggestionsRequestSchema, bookGoalSuggestionsResponseSchema, 30_000); }
export function createBook(input: CreateBookInput, generationRequestKey: string) { return request("post", "/books", { ...input, generationRequestKey }, createBookRequestSchema, bookSchema, 15 * 60_000); }
export function fetchBookDetail(bookKey: string) { return request("post", `/books/${keySchema.parse(bookKey)}/detail`, {}, detailRequestSchema, detailResponseSchema); }
export function previewBookExtension(bookKey: string, chapterCount: ExtensionChapterCount) { return request("post", `/books/${keySchema.parse(bookKey)}/extension/preview`, { chapterCount }, bookExtensionPreviewRequestSchema, bookExtensionPreviewResponseSchema, 30_000); }
export function extendBook(bookKey: string, chapterCount: ExtensionChapterCount, titles: string[], requestKey: string) { return request("post", `/books/${keySchema.parse(bookKey)}/extension`, { chapterCount, titles, requestKey }, bookExtensionRequestSchema, bookSchema, 15 * 60_000); }
export function fetchBookShareDetail(bookKey: string) { return request("post", `/books/${keySchema.parse(bookKey)}/share/detail`, {}, bookShareDetailRequestSchema, bookShareSchema); }
export function updateBookShare(bookKey: string, active: boolean) { return request("post", `/books/${keySchema.parse(bookKey)}/share/update`, { active }, bookShareUpdateRequestSchema, bookShareSchema); }
export async function fetchPublicBookShare(token: string) {
  try {
    const payload = publicBookShareReadRequestSchema.parse({ token });
    const response = await publicApiClient.post("/public/books/shares/read", payload);
    return unwrap(response.data, detailResponseSchema);
  } catch (error) {
    throw responseError(error);
  }
}
export function retryBook(bookKey: string, requestKey: string) { return request("post", `/books/${keySchema.parse(bookKey)}/retry`, { requestKey }, mutationRequestSchema, bookSchema); }
export function cancelBook(bookKey: string, requestKey: string) { return request("post", `/books/${keySchema.parse(bookKey)}/cancel`, { requestKey }, mutationRequestSchema, bookSchema); }
export function setBookFavorite(bookKey: string, isFavorite: boolean) { return request("post", `/books/${keySchema.parse(bookKey)}/favorite`, { isFavorite }, favoriteRequestSchema, bookSchema); }
export function deleteBook(bookKey: string, requestKey: string) { return request("delete", `/books/${keySchema.parse(bookKey)}`, { requestKey }, mutationRequestSchema, z.strictObject({ key: keySchema })); }
export function updateBookChapterProgress(bookKey: string, chapterKey: string, input: { progressSeconds: number; isCompleted: boolean }) {
  return request("patch", `/books/${keySchema.parse(bookKey)}/chapters/${keySchema.parse(chapterKey)}/progress`, input, chapterProgressRequestSchema, progressResponseSchema);
}

export async function askBookAssistant(message: string, requestKey: string) {
  const { organizationKey, scopeKey } = getBooksContext();
  try {
    const response = await apiClient.post("/assistant/respond", { organizationKey, scopeKey, input: { surface: "book-workspace", requestKey: z.string().trim().min(1).max(180).parse(requestKey), message: z.string().trim().min(1).max(8_000).parse(message), currentNote: { title: "", content: "" } } }, { timeout: 15 * 60_000 });
    return unwrap(response.data, assistantResponseSchema);
  } catch (error) {
    throw responseError(error);
  }
}
