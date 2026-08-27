import { beforeEach, expect, mock, test } from "bun:test";

const calls: { method: string; path: string; body: unknown; config?: unknown }[] = [];
let lifecycleFailure = false;
const authState = { organization: { key: "org-key" }, scope: { key: "scope-key" } };
const book = { key: "book-key", title: "A Better Practice", subtitle: "Small systems, durable change", description: "A practical guide.", status: "ready", isFavorite: false, estimatedMinutes: 45, chapterCount: 1, progressPercent: 25, currentChapterKey: "chapter-key" };
const chapter = { key: "chapter-key", title: "Begin", description: "Start with the useful part.", content: "Chapter body", position: 1, estimatedMinutes: 8, audioUrl: "https://example.com/chapter.mp3", audioDurationSeconds: 480, progressSeconds: 120, isCompleted: false };

mock.module("@/state/auth", () => ({ useAuthStore: { getState: () => authState } }));
mock.module("./api-client", () => ({ apiClient: {
  post: async (path: string, body: unknown, config?: unknown) => {
    calls.push({ method: "POST", path, body, config });
    if (lifecycleFailure && path.endsWith("/cancel")) throw { response: { data: { success: false, error: { code: "BOOK_CONFLICT", message: "Completed books cannot be cancelled." } } } };
    const data = path === "/books/overview" ? { books: [book] } : path === "/books/topic-suggestions" ? { topics: Array.from({ length: 10 }, (_, index) => `Creative topic ${index + 1}`) } : path === "/books/goal-suggestions" ? { goals: Array.from({ length: 10 }, (_, index) => `Useful reader goal ${index + 1}`) } : path === "/books" || path.endsWith("/retry") || path.endsWith("/cancel") ? book : path === "/assistant/respond" ? (body as { input?: { message?: string } }).input?.message.includes("weather") ? { type: "unsupported", message: "This request is not supported in Ascend.", sources: [] } : { type: "answer", message: "Your book is ready.", sources: [] } : { book, chapters: [chapter] };
    return { data: { success: true, data } };
  },
  patch: async (path: string, body: unknown, config?: unknown) => {
    calls.push({ method: "PATCH", path, body, config });
    return { data: { success: true, data: { book: { ...book, progressPercent: 100 }, chapter: { ...chapter, progressSeconds: 480, isCompleted: true } } } };
  },
  delete: async (path: string, config?: { data?: unknown }) => {
    calls.push({ method: "DELETE", path, body: config?.data, config });
    return { data: { success: true, data: { key: "book-key" } } };
  },
} }));

const client = await import("./books-client");
beforeEach(() => { calls.splice(0); lifecycleFailure = false; });

test("sends strictly scoped overview, creation, detail, and progress requests", async () => {
  expect((await client.fetchBooksOverview()).books).toHaveLength(1);
  await client.createBook({ topic: "Useful habits", goal: "Build a durable practice", currentKnowledge: "A curious beginner", writingTone: "Warm and direct", language: "English", chapterCount: 25, narratorVoiceKey: "clear", narrationPace: 1, archiveDocumentKeys: ["document-key"], chapterImages: true, additionalInstructions: "Use concrete examples." }, "request-key");
  await client.fetchBookDetail("book-key");
  await client.updateBookChapterProgress("book-key", "chapter-key", { progressSeconds: 480, isCompleted: true });
  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual(["POST /books/overview", "POST /books", "POST /books/book-key/detail", "PATCH /books/book-key/chapters/chapter-key/progress"]);
  expect(calls[0]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key" });
  expect(calls[1]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", generationRequestKey: "request-key", topic: "Useful habits", goal: "Build a durable practice", currentKnowledge: "A curious beginner", writingTone: "Warm and direct", language: "English", chapterCount: 25, narratorVoiceKey: "clear", narrationPace: 1, archiveDocumentKeys: ["document-key"], chapterImages: true, additionalInstructions: "Use concrete examples." });
  expect(calls[1]?.config).toEqual({ timeout: 15 * 60_000 });
  expect(calls[3]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", progressSeconds: 480, isCompleted: true });
});

test("requests ten fresh topic suggestions with exclusions", async () => {
  expect((await client.suggestBookTopics(["Old idea"])).topics).toHaveLength(10);
  expect(calls[0]).toEqual({ method: "POST", path: "/books/topic-suggestions", body: { organizationKey: "org-key", scopeKey: "scope-key", excludeTopics: ["Old idea"] }, config: { timeout: 30_000 } });
});

test("requests ten fresh goal suggestions for the selected topic", async () => {
  expect((await client.suggestBookGoals("Decision making", ["Old goal"])).goals).toHaveLength(10);
  expect(calls[0]).toEqual({ method: "POST", path: "/books/goal-suggestions", body: { organizationKey: "org-key", scopeKey: "scope-key", topic: "Decision making", excludeGoals: ["Old goal"] }, config: { timeout: 30_000 } });
});

test("rejects invalid requests and unsafe response fields", async () => {
  expect(client.createBookRequestSchema.safeParse({ organizationKey: "org", scopeKey: "scope", generationRequestKey: "request", topic: "topic", goal: "goal", currentKnowledge: "reader", writingTone: "warm", language: "en", chapterCount: 99, narratorVoiceKey: "clear", narrationPace: 1, archiveDocumentKeys: [], chapterImages: true }).success).toBe(false);
  expect(client.createBookRequestSchema.safeParse({ organizationKey: "org", scopeKey: "scope", generationRequestKey: "request", topic: "Useful habits", goal: "Build a durable practice", currentKnowledge: "", writingTone: "warm", language: "en", chapterCount: 25, narratorVoiceKey: "clear", narrationPace: 1, archiveDocumentKeys: [], chapterImages: true }).success).toBe(true);
  expect(client.bookSchema.safeParse({ ...book, internalPrompt: "secret" }).success).toBe(false);
  expect(client.bookChapterSchema.safeParse({ ...chapter, storageKey: "private/audio.mp3" }).success).toBe(false);
  await expect(client.updateBookChapterProgress("book-key", "chapter-key", { progressSeconds: -1, isCompleted: false })).rejects.toThrow();
  expect(calls).toHaveLength(0);
});

test("parses the final lifecycle and media DTO strictly", () => {
  expect(client.bookSchema.parse({ ...book, status: "failed", narrator: { key: "warm", name: "Warm" }, generationProgressPercent: 64, failureMessage: "Narration failed." })).toMatchObject({ status: "failed", generationProgressPercent: 64 });
  expect(client.bookSchema.parse({ ...book, status: "cancelled" }).status).toBe("cancelled");
  expect(client.bookChapterSchema.parse({ ...chapter, imageUrl: "https://example.com/chapter.jpg" }).imageUrl).toBe("https://example.com/chapter.jpg");
  expect(client.bookSchema.safeParse({ ...book, narrator: { key: "unknown", name: "Unknown" } }).success).toBe(false);
  expect(client.chapterProgressRequestSchema.safeParse({ organizationKey: "org", scopeKey: "scope", progressSeconds: 1.5, isCompleted: false }).success).toBe(false);
});

test("asks Core to create books on the scoped book workspace", async () => {
  expect(await client.askBookAssistant("Create a short book about useful habits", "request-key")).toEqual({ type: "answer", message: "Your book is ready.", sources: [] });
  expect(calls[0]).toMatchObject({ method: "POST", path: "/assistant/respond", config: { timeout: 15 * 60_000 } });
  expect(calls[0]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", input: { surface: "book-workspace", requestKey: "request-key", message: "Create a short book about useful habits", currentNote: { title: "", content: "" } } });
});

test("parses unsupported Ascend requests", async () => {
  expect(await client.askBookAssistant("What is the weather?", "request-key")).toEqual({ type: "unsupported", message: "This request is not supported in Ascend.", sources: [] });
});

test("sends scoped retry, cancel, and delete lifecycle requests", async () => {
  await client.retryBook("book-key", "retry-key");
  await client.cancelBook("book-key", "cancel-key");
  await client.deleteBook("book-key", "delete-key");
  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual(["POST /books/book-key/retry", "POST /books/book-key/cancel", "DELETE /books/book-key"]);
  expect(calls.map(({ body }) => body)).toEqual([
    { organizationKey: "org-key", scopeKey: "scope-key", requestKey: "retry-key" },
    { organizationKey: "org-key", scopeKey: "scope-key", requestKey: "cancel-key" },
    { organizationKey: "org-key", scopeKey: "scope-key", requestKey: "delete-key" },
  ]);
});

test("parses the strict backend error envelope", async () => {
  lifecycleFailure = true;
  await expect(client.cancelBook("book-key", "conflict-key")).rejects.toThrow("Completed books cannot be cancelled.");
});
