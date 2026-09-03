import { beforeEach, expect, mock, test } from "bun:test";
import { z } from "zod";

const calls: { method: string; path: string; body: unknown; config?: unknown }[] = [];
let lifecycleFailure = false;
let favoriteDeleteFailure = false;
let publicFailure = false;
const authState: { organization: { key: string } | null; scope: { key: string } | null } = { organization: { key: "org-key" }, scope: { key: "scope-key" } };
const book = { key: "book-key", title: "A Better Practice", subtitle: "Small systems, durable change", description: "A practical guide.", status: "ready", isFavorite: false, isExtending: false, estimatedMinutes: 45, chapterCount: 1, progressPercent: 25, currentChapterKey: "chapter-key", createdAt: "2026-08-28T09:00:00.000Z", updatedAt: "2026-08-28T10:00:00.000Z" };
const chapter = { key: "chapter-key", title: "Begin", description: "Start with the useful part.", content: "Chapter body", position: 1, estimatedMinutes: 8, audioUrl: "https://example.com/chapter.mp3", audioDurationSeconds: 480, progressSeconds: 120, isCompleted: false };
const share = { key: "share-key", url: "https://vorinthex.com/share/books/token", active: true, createdAt: "2026-08-28T10:00:00.000Z", updatedAt: "2026-08-28T10:00:00.000Z" };

mock.module("@/state/auth", () => ({ useAuthStore: { getState: () => authState } }));
mock.module("./api-client", () => ({ apiClient: {
  post: async (path: string, body: unknown, config?: unknown) => {
    calls.push({ method: "POST", path, body, config });
    if (lifecycleFailure && path.endsWith("/cancel")) throw { response: { data: { success: false, error: { code: "BOOK_CONFLICT", message: "Completed audio books cannot be cancelled." } } } };
    const data = path === "/app/search" ? { query: "practice", groups: [{ collectionSlug: "books", results: [{ ...book, score: 0.9 }] }] } : path.endsWith("/share/detail") || path.endsWith("/share/update") ? { ...share, active: (body as { active?: boolean }).active ?? share.active } : path.endsWith("/extension/preview") ? { titles: ["Continue the Practice", "Make It Durable", "Teach the System"] } : path.endsWith("/extension") ? { ...book, status: "queued", chapterCount: 4 } : path === "/books/overview" ? { books: [book] } : path === "/books/topic-suggestions" ? { topics: Array.from({ length: 10 }, (_, index) => `Creative topic ${index + 1}`) } : path === "/books/goal-suggestions" ? { goals: Array.from({ length: 10 }, (_, index) => `Useful reader goal ${index + 1}`) } : path === "/books" || path.endsWith("/retry") || path.endsWith("/cancel") || path.endsWith("/favorite") ? book : path === "/assistant/respond" ? (body as { input?: { message?: string } }).input?.message.includes("weather") ? { type: "unsupported", message: "This request is not supported in Ascend.", sources: [] } : { type: "answer", message: "Your book is ready.", sources: [] } : { book, chapters: [chapter] };
    return { data: { success: true, data } };
  },
  patch: async (path: string, body: unknown, config?: unknown) => {
    calls.push({ method: "PATCH", path, body, config });
    return { data: { success: true, data: { book: { ...book, progressPercent: 100 }, chapter: { ...chapter, progressSeconds: 480, isCompleted: true } } } };
  },
  delete: async (path: string, config?: { data?: unknown }) => {
    calls.push({ method: "DELETE", path, body: config?.data, config });
    if (favoriteDeleteFailure) throw { response: { data: { success: false, error: { code: "BOOK_FAVORITE", message: "Unfavorite the audio book before deleting it." } } } };
    return { data: { success: true, data: { key: "book-key" } } };
  },
} }));
mock.module("@/lib/public-api-client", () => ({ publicApiClient: {
  post: async (path: string, body: unknown) => {
    calls.push({ method: "PUBLIC POST", path, body });
    if (publicFailure) throw { response: { status: 410, data: { success: false, error: { code: "BOOK_SHARE_INACTIVE", message: "This share is inactive." } } } };
    return { data: { success: true, data: { book, chapters: [chapter] } } };
  },
} }));

const client = await import("./books-client");
const appSearchClient = await import("./app-search-client");
beforeEach(() => { calls.splice(0); lifecycleFailure = false; favoriteDeleteFailure = false; publicFailure = false; authState.organization = { key: "org-key" }; authState.scope = { key: "scope-key" }; });

test("sends strictly scoped overview, creation, detail, and progress requests", async () => {
  expect((await client.fetchBooksOverview()).books).toHaveLength(1);
  await client.createBook({ topic: "Useful habits", goal: "Build a durable practice", currentKnowledge: "A curious beginner", writingTone: "Warm and direct", language: "English", narratorVoiceKey: "clear", narrationPace: 1, archiveDocumentKeys: ["document-key"], additionalInstructions: "Use concrete examples." }, "request-key");
  await client.fetchBookDetail("book-key");
  await client.updateBookChapterProgress("book-key", "chapter-key", { progressSeconds: 480, isCompleted: true });
  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual(["POST /books/overview", "POST /books", "POST /books/book-key/detail", "PATCH /books/book-key/chapters/chapter-key/progress"]);
  expect(calls[0]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key" });
  expect(calls[1]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", generationRequestKey: "request-key", topic: "Useful habits", goal: "Build a durable practice", currentKnowledge: "A curious beginner", writingTone: "Warm and direct", language: "English", narratorVoiceKey: "clear", narrationPace: 1, archiveDocumentKeys: ["document-key"], additionalInstructions: "Use concrete examples." });
  expect(calls[1]?.config).toEqual({ timeout: 15 * 60_000 });
  expect(calls[3]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", progressSeconds: 480, isCompleted: true });
});

test("searches books through app.search without recording history for result refreshes", async () => {
  const controller = new AbortController();
  expect(await client.searchBooks("practice", controller.signal, false)).toEqual([book]);
  expect(calls[0]).toEqual({ method: "POST", path: "/app/search", body: { organizationKey: "org-key", scopeKey: "scope-key", query: "practice", collectionSlugs: ["books"], recordHistory: false, limit: 50 }, config: { signal: controller.signal, timeout: 15_000 } });
});

test("strictly parses app.search retrieval destinations and rejects unsafe metadata", () => {
  const result = appSearchClient.appSearchOutputSchema.parse({
    query: "roadmap",
    groups: [{ collectionSlug: "documents", results: [{ key: "document-key", name: "Roadmap" }] }],
    retrieval: { query: "roadmap", limit: 10, searchCollectionSlugs: ["documents"], groups: [{ collectionSlug: "folders", results: [{ key: "folder-key", label: "Plans", destinationCollectionSlug: "documents" }] }] },
  });
  expect(result.retrieval?.groups[0]?.results[0]).toEqual({ key: "folder-key", label: "Plans", destinationCollectionSlug: "documents" });
  for (const data of [
    { query: "roadmap", groups: [], unexpected: true },
    { query: "roadmap", groups: [], retrieval: { query: "roadmap", limit: 10, groups: [{ collectionSlug: "documents", results: Array.from({ length: 51 }, (_, index) => ({ key: String(index), label: String(index) })) }] } },
    { query: "roadmap", groups: [], retrieval: { query: "roadmap", limit: 10, groups: [{ collectionSlug: "documents", results: [{ key: "key", label: "Label", internalPath: "secret" }] }] } },
    { query: "roadmap", groups: [], retrieval: { limit: 10, groups: [{ collectionSlug: "documents", results: [{ key: "key", label: "Label" }] }] } },
  ]) expect(appSearchClient.appSearchOutputSchema.safeParse(data).success).toBe(false);
});

test("builds stable app.search query keys and strictly parses requested groups", () => {
  expect(appSearchClient.appSearchQueryKey("member:scope", { query: " roadmap ", collectionSlugs: ["documents"] })).toEqual(["app-search", "member:scope", { query: "roadmap", collectionSlugs: ["documents"], recordHistory: false, limit: 10 }]);
  expect(() => appSearchClient.appSearchQueryKey("member:scope", { query: "roadmap", collectionSlugs: ["documents", "documents"] })).toThrow();
  const output = { query: "roadmap", groups: [{ collectionSlug: "documents" as const, results: [{ key: "document-key", name: "Roadmap" }] }] };
  expect(appSearchClient.appSearchResults(output, "documents", z.strictObject({ key: z.string(), name: z.string() }))).toEqual([{ key: "document-key", name: "Roadmap" }]);
  expect(() => appSearchClient.appSearchResults(output, "files", z.unknown())).toThrow("omitted files");
  expect(() => appSearchClient.appSearchResults(output, "documents", z.strictObject({ key: z.string() }))).toThrow("Unrecognized key");
});

test("accepts normalized creation ranges for every timestamped app.search collection", () => {
  const createdFrom = "2026-08-01T02:00:00+02:00";
  for (const collectionSlug of appSearchClient.appSearchCollectionSlugSchema.options.filter((slug) => slug !== "countries")) {
    expect(appSearchClient.appSearchInputSchema.parse({ query: "recent", collectionSlugs: [collectionSlug], filters: { createdFrom } }).filters?.createdFrom, collectionSlug).toBe("2026-08-01T00:00:00.000Z");
  }
  expect(appSearchClient.appSearchInputSchema.safeParse({ query: "recent", collectionSlugs: ["countries"], filters: { createdFrom } }).success).toBe(false);
  expect(appSearchClient.appSearchInputSchema.safeParse({ query: "recent", collectionSlugs: ["books"], filters: { createdFrom: "2026-08-02T00:00:00.000Z", createdTo: "2026-08-01T00:00:00.000Z" } }).success).toBe(false);
});

test("requests ten fresh topic suggestions with exclusions", async () => {
  expect((await client.suggestBookTopics(["Old idea"])).topics).toHaveLength(10);
  expect(calls[0]).toEqual({ method: "POST", path: "/books/topic-suggestions", body: { organizationKey: "org-key", scopeKey: "scope-key", excludeTopics: ["Old idea"] }, config: { timeout: 50_000 } });
});

test("requests ten fresh goal suggestions for the selected topic", async () => {
  expect((await client.suggestBookGoals("Decision making", ["Old goal"])).goals).toHaveLength(10);
  expect(calls[0]).toEqual({ method: "POST", path: "/books/goal-suggestions", body: { organizationKey: "org-key", scopeKey: "scope-key", topic: "Decision making", excludeGoals: ["Old goal"] }, config: { timeout: 50_000 } });
});

test("previews and generates strict scoped book extensions", async () => {
  expect(await client.previewBookExtension("book-key", 3)).toEqual({ titles: ["Continue the Practice", "Make It Durable", "Teach the System"] });
  expect((await client.extendBook("book-key", 3, ["Continue the Practice", "Make It Durable", "Teach the System"], "extension-key")).chapterCount).toBe(4);
  expect(calls).toEqual([
    { method: "POST", path: "/books/book-key/extension/preview", body: { organizationKey: "org-key", scopeKey: "scope-key", chapterCount: 3 }, config: { timeout: 30_000 } },
    { method: "POST", path: "/books/book-key/extension", body: { organizationKey: "org-key", scopeKey: "scope-key", chapterCount: 3, titles: ["Continue the Practice", "Make It Durable", "Teach the System"], requestKey: "extension-key" }, config: { timeout: 15 * 60_000 } },
  ]);
  expect(client.bookExtensionPreviewRequestSchema.safeParse({ organizationKey: "org", scopeKey: "scope", chapterCount: 2 }).success).toBe(false);
  expect(client.bookExtensionRequestSchema.safeParse({ organizationKey: "org", scopeKey: "scope", chapterCount: 3, titles: ["One", "Two", "Three"], requestKey: "key", extra: true }).success).toBe(false);
  expect(client.bookExtensionRequestSchema.safeParse({ organizationKey: "org", scopeKey: "scope", chapterCount: 3, titles: ["Title"], requestKey: "key" }).success).toBe(false);
  expect(client.bookExtensionPreviewResponseSchema.safeParse({ titles: ["Title"], extra: true }).success).toBe(false);
});

test("rejects invalid requests and unsafe response fields", async () => {
  expect(client.createBookRequestSchema.safeParse({ organizationKey: "org", scopeKey: "scope", generationRequestKey: "request", topic: "Useful habits", goal: "Build a durable practice", currentKnowledge: "", writingTone: "warm", language: "en", chapterCount: 25, narratorVoiceKey: "clear", narrationPace: 1, archiveDocumentKeys: [] }).success).toBe(false);
  expect(client.createBookRequestSchema.safeParse({ organizationKey: "org", scopeKey: "scope", generationRequestKey: "request", topic: "Useful habits", goal: "Build a durable practice", currentKnowledge: "", writingTone: "warm", language: "en", narratorVoiceKey: "clear", narrationPace: 1, archiveDocumentKeys: [] }).success).toBe(true);
  expect(client.createBookRequestSchema.safeParse({ organizationKey: "org", scopeKey: "scope", generationRequestKey: "request", topic: "Useful habits", goal: "Build a durable practice", currentKnowledge: "", writingTone: "warm", language: "en", narratorVoiceKey: "clear", narrationPace: 1, archiveDocumentKeys: Array.from({ length: 11 }, (_, index) => `document-${index}`) }).success).toBe(false);
  expect(client.bookSchema.safeParse({ ...book, internalPrompt: "secret" }).success).toBe(false);
  expect(client.bookChapterSchema.safeParse({ ...chapter, storageKey: "private/audio.mp3" }).success).toBe(false);
  await expect(client.updateBookChapterProgress("book-key", "chapter-key", { progressSeconds: -1, isCompleted: false })).rejects.toThrow();
  expect(calls).toHaveLength(0);
});

test("parses the final lifecycle and media DTO strictly", () => {
  expect(client.bookSchema.parse({ ...book, status: "failed", narrator: { key: "warm", name: "Warm" }, generationProgressPercent: 64, failureMessage: "Narration failed." })).toMatchObject({ status: "failed", generationProgressPercent: 64 });
  expect(client.bookSchema.parse({ ...book, status: "cancelled" }).status).toBe("cancelled");
  expect(client.bookChapterSchema.safeParse({ ...chapter, imageUrl: "https://example.com/chapter.jpg" }).success).toBe(false);
  expect(client.bookSchema.safeParse({ ...book, narrator: { key: "unknown", name: "Unknown" } }).success).toBe(false);
  expect(client.bookSchema.safeParse({ ...book, createdAt: "not-a-date" }).success).toBe(false);
  const { createdAt: _createdAt, ...withoutCreatedAt } = book;
  expect(client.bookSchema.safeParse(withoutCreatedAt).success).toBe(false);
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

test("sends scoped favorite, retry, cancel, and delete lifecycle requests", async () => {
  await client.setBookFavorite("book-key", true);
  await client.retryBook("book-key", "retry-key");
  await client.cancelBook("book-key", "cancel-key");
  await client.deleteBook("book-key", "delete-key");
  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual(["POST /books/book-key/favorite", "POST /books/book-key/retry", "POST /books/book-key/cancel", "DELETE /books/book-key"]);
  expect(calls.map(({ body }) => body)).toEqual([
    { organizationKey: "org-key", scopeKey: "scope-key", isFavorite: true },
    { organizationKey: "org-key", scopeKey: "scope-key", requestKey: "retry-key" },
    { organizationKey: "org-key", scopeKey: "scope-key", requestKey: "cancel-key" },
    { organizationKey: "org-key", scopeKey: "scope-key", requestKey: "delete-key" },
  ]);
});

test("parses the strict backend error envelope", async () => {
  lifecycleFailure = true;
  await expect(client.cancelBook("book-key", "conflict-key")).rejects.toThrow("Completed audio books cannot be cancelled.");
});

test("preserves the stable favorite deletion conflict code", async () => {
  favoriteDeleteFailure = true;
  try {
    await client.deleteBook("book-key", "delete-key");
    throw new Error("Expected favorite deletion to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(client.BookClientError);
    expect((error as InstanceType<typeof client.BookClientError>).code).toBe("BOOK_FAVORITE");
  }
});

test("sends strict owner share detail and update requests", async () => {
  expect(await client.fetchBookShareDetail("book-key")).toEqual(share);
  expect((await client.updateBookShare("book-key", false)).active).toBe(false);
  expect(calls).toEqual([
    { method: "POST", path: "/books/book-key/share/detail", body: { organizationKey: "org-key", scopeKey: "scope-key" }, config: undefined },
    { method: "POST", path: "/books/book-key/share/update", body: { organizationKey: "org-key", scopeKey: "scope-key", active: false }, config: undefined },
  ]);
  expect(client.bookShareSchema.safeParse({ ...share, internalBookKey: "private" }).success).toBe(false);
  expect(client.bookShareUpdateRequestSchema.safeParse({ organizationKey: "org", scopeKey: "scope", active: true, extra: true }).success).toBe(false);
  expect(client.publicBookShareAccessSchema.safeParse({ status: "active", extra: true }).success).toBe(false);
});

test("reads a public share without authenticated organization or scope context", async () => {
  authState.organization = null;
  authState.scope = null;
  const token = "p".repeat(43);
  expect((await client.fetchPublicBookShare(token)).book.key).toBe("book-key");
  expect(calls).toEqual([{ method: "PUBLIC POST", path: "/public/books/shares/read", body: { token } }]);
  expect(client.publicBookShareReadRequestSchema.safeParse({ token: "token", organizationKey: "private" }).success).toBe(false);
});

test("preserves stable public share errors and status", async () => {
  publicFailure = true;
  try {
    await client.fetchPublicBookShare("i".repeat(43));
    throw new Error("Expected inactive share to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(client.BookClientError);
    expect((error as InstanceType<typeof client.BookClientError>).code).toBe("BOOK_SHARE_INACTIVE");
    expect((error as InstanceType<typeof client.BookClientError>).status).toBe(410);
  }
});
