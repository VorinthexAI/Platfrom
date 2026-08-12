import { beforeEach, expect, mock, test } from "bun:test";

const calls: { method: string; path: string; body: unknown; config?: unknown }[] = [];
const authState = { organization: { key: "org-key" }, scope: { key: "scope-key" }, contentExecution: { agentKey: "agent-key" } };
const book = { key: "book-key", title: "A Better Practice", subtitle: "Small systems, durable change", description: "A practical guide.", status: "ready", estimatedMinutes: 45, chapterCount: 1, progressPercent: 25, currentChapterKey: "chapter-key" };
const chapter = { key: "chapter-key", title: "Begin", description: "Start with the useful part.", content: "Chapter body", position: 0, estimatedMinutes: 8, audioUrl: "https://example.com/chapter.mp3", audioDurationSeconds: 480, progressSeconds: 120, isCompleted: false };

mock.module("@/state/auth", () => ({ useAuthStore: { getState: () => authState } }));
mock.module("./api-client", () => ({ apiClient: {
  post: async (path: string, body: unknown, config?: unknown) => {
    calls.push({ method: "POST", path, body, config });
    const data = path === "/books/overview" ? { books: [book] } : path === "/books" ? book : path === "/assistant/respond" ? { type: "answer", message: "Your book is ready.", sources: [] } : { book, chapters: [chapter] };
    return { data: { success: true, data } };
  },
  patch: async (path: string, body: unknown, config?: unknown) => {
    calls.push({ method: "PATCH", path, body, config });
    return { data: { success: true, data: { book: { ...book, progressPercent: 100 }, chapter: { ...chapter, progressSeconds: 480, isCompleted: true } } } };
  },
} }));

const client = await import("./books-client");
beforeEach(() => calls.splice(0));

test("sends strictly scoped overview, creation, detail, and progress requests", async () => {
  expect((await client.fetchBooksOverview()).books).toHaveLength(1);
  await client.createBook({ topic: "Useful habits", goal: "Build a durable practice", audience: "A curious beginner", tone: "Warm and direct", language: "English", length: "standard", sourceNotes: "Use concrete examples." }, "request-key");
  await client.fetchBookDetail("book-key");
  await client.updateBookChapterProgress("book-key", "chapter-key", { progressSeconds: 480, isCompleted: true });
  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual(["POST /books/overview", "POST /books", "POST /books/book-key/detail", "PATCH /books/book-key/chapters/chapter-key/progress"]);
  expect(calls[0]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key" });
  expect(calls[1]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", generationRequestKey: "request-key", topic: "Useful habits", goal: "Build a durable practice", audience: "A curious beginner", tone: "Warm and direct", language: "English", length: "standard", sourceNotes: "Use concrete examples." });
  expect(calls[1]?.config).toEqual({ timeout: 15 * 60_000 });
  expect(calls[3]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", progressSeconds: 480, isCompleted: true });
});

test("rejects invalid requests and unsafe response fields", async () => {
  expect(client.createBookRequestSchema.safeParse({ organizationKey: "org", scopeKey: "scope", topic: "ok", goal: "goal", audience: "reader", tone: "warm", language: "en", length: "epic" }).success).toBe(false);
  expect(client.bookSchema.safeParse({ ...book, internalPrompt: "secret" }).success).toBe(false);
  expect(client.bookChapterSchema.safeParse({ ...chapter, storageKey: "private/audio.mp3" }).success).toBe(false);
  await expect(client.updateBookChapterProgress("book-key", "chapter-key", { progressSeconds: -1, isCompleted: false })).rejects.toThrow();
  expect(calls).toHaveLength(0);
});

test("asks Core to create books on the scoped book workspace", async () => {
  expect(await client.askBookAssistant("Create a short book about useful habits", "request-key")).toEqual({ type: "answer", message: "Your book is ready.", sources: [] });
  expect(calls[0]).toMatchObject({ method: "POST", path: "/assistant/respond", config: { timeout: 15 * 60_000 } });
  expect(calls[0]?.body).toEqual({ organizationKey: "org-key", agentKey: "agent-key", input: { surface: "book-workspace", requestKey: "request-key", message: "Create a short book about useful habits", currentNote: { title: "", content: "" } } });
});
