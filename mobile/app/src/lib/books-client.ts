import { z } from "zod";

import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/state/auth";

const keySchema = z.string().trim().min(1);
const contextSchema = z.strictObject({ organizationKey: keySchema, scopeKey: keySchema });
export const bookLengthSchema = z.enum(["short", "standard", "deep"]);

export const bookSchema = z.strictObject({
  key: keySchema,
  title: z.string().min(1),
  subtitle: z.string().min(1),
  description: z.string().min(1),
  status: z.string().min(1),
  coverUrl: z.url().optional(),
  estimatedMinutes: z.number().int().nonnegative(),
  chapterCount: z.number().int().nonnegative(),
  progressPercent: z.number().min(0).max(100),
  currentChapterKey: keySchema.optional(),
});

export const bookChapterSchema = z.strictObject({
  key: keySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  content: z.string().min(1).optional(),
  position: z.number().int().nonnegative(),
  estimatedMinutes: z.number().int().nonnegative().optional(),
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
  audience: z.string().trim().min(2).max(1_000),
  tone: z.string().trim().min(2).max(200),
  length: bookLengthSchema,
  language: z.string().trim().min(2).max(100),
  sourceNotes: z.string().trim().max(12_000).optional(),
});
const detailRequestSchema = contextSchema;
export const chapterProgressRequestSchema = contextSchema.extend({
  progressSeconds: z.number().nonnegative(),
  isCompleted: z.boolean(),
});

const overviewResponseSchema = z.strictObject({ books: z.array(bookSchema) });
const detailResponseSchema = z.strictObject({ book: bookSchema, chapters: z.array(bookChapterSchema) });
const progressResponseSchema = z.strictObject({ chapter: bookChapterSchema, book: bookSchema });
const failureSchema = z.strictObject({ success: z.literal(false), error: z.strictObject({ message: z.string().min(1) }) });

export type Book = z.infer<typeof bookSchema>;
export type BookChapter = z.infer<typeof bookChapterSchema>;
export type BookDetail = z.infer<typeof detailResponseSchema>;
export type CreateBookInput = Omit<z.input<typeof createBookRequestSchema>, "organizationKey" | "scopeKey" | "generationRequestKey">;

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
  if (!response.success) throw new Error(response.error.message);
  return response.data;
}

function responseError(error: unknown) {
  const parsed = failureSchema.safeParse((error as { response?: { data?: unknown } }).response?.data);
  return parsed.success ? new Error(parsed.data.error.message) : error;
}

async function request<T>(method: "post" | "patch", path: string, body: unknown, requestSchema: z.ZodType, responseSchema: z.ZodType<T>, timeout?: number) {
  try {
    const payload = requestSchema.parse({ ...getBooksContext(), ...(body as Record<string, unknown>) });
    const response = await apiClient[method](path, payload, timeout ? { timeout } : undefined);
    return unwrap(response.data, responseSchema);
  } catch (error) {
    throw responseError(error);
  }
}

export function fetchBooksOverview() { return request("post", "/books/overview", {}, overviewRequestSchema, overviewResponseSchema); }
export function createBook(input: CreateBookInput, generationRequestKey: string) { return request("post", "/books", { ...input, generationRequestKey }, createBookRequestSchema, bookSchema, 15 * 60_000); }
export function fetchBookDetail(bookKey: string) { return request("post", `/books/${keySchema.parse(bookKey)}/detail`, {}, detailRequestSchema, detailResponseSchema); }
export function updateBookChapterProgress(bookKey: string, chapterKey: string, input: { progressSeconds: number; isCompleted: boolean }) {
  return request("patch", `/books/${keySchema.parse(bookKey)}/chapters/${keySchema.parse(chapterKey)}/progress`, input, chapterProgressRequestSchema, progressResponseSchema);
}
