import { beforeEach, expect, mock, test } from "bun:test";

const calls: { url: string; body: Record<string, any>; config: Record<string, any> }[] = [];
const testRuntime = globalThis as typeof globalThis & { __archiveApiPost?: (...input: any[]) => unknown };
let authState = {
  organization: { key: "org-authenticated" },
  scope: { key: "scope-authenticated" },
  contentExecution: { agentKey: "agent-authenticated" },
};
let queuedUpload = false;
let responseForTool: ((tool: string) => unknown) | undefined;
const digestInputs: string[] = [];

mock.module("@/state/auth", () => ({
  useAuthStore: { getState: () => authState },
}));
mock.module("./api-client", () => ({
  apiClient: {
    post: (...args: any[]) => testRuntime.__archiveApiPost?.(...args),
  },
}));
mock.module("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: string, value: string) => { digestInputs.push(value); return "upload-digest"; },
}));

testRuntime.__archiveApiPost = async (url: string, body: Record<string, any>, config: Record<string, any>) => {
  calls.push({ url, body, config });
  const tool = url.split("/").at(-1);
  if (tool === "document.parse" && queuedUpload) {
    return { data: { success: true, data: { job: { key: "a".repeat(64), state: "waiting" } } } };
  }
  if (url.includes("/content/document-jobs/")) {
    return { data: { success: true, data: { document: { key: "document", name: "Note", isFavorite: false, updatedAt: "2026-08-10T00:00:00.000Z" } } } };
  }
  const response = responseForTool?.(tool ?? "");
  if (response) return response;
  if (tool === "document.create" || tool === "document.parse") {
    return { data: { success: true, data: { document: { key: "document", name: "Note", isFavorite: false, updatedAt: "2026-08-10T00:00:00.000Z" } } } };
  }
  if (tool === "folder.create") {
    return { data: { success: true, data: { results: [{ success: true, data: { folder: { key: "folder", name: "Work" } } }] } } };
  }
  if (tool === "document.update") {
    return { data: { success: true, data: { results: [{ success: true, data: { document: { key: "document", name: "Note", isFavorite: false, updatedAt: "2026-08-10T00:01:00.000Z" } } }] } } };
  }
  throw new Error(`Unexpected tool: ${tool}`);
};

const {
  autocompleteContent,
  askPersonalAssistant,
  createContentDocument,
  createContentFolder,
  copyContentDocument,
  downloadContentDocument,
  enhanceContent,
  findContentDocumentVersion,
  loadInitialContentLocation,
  listContentSearchHistory,
  moveContentFolder,
  moveContentDocument,
  renameContentDocument,
  saveContentDocument,
  searchContent,
  searchContentMatches,
  summarizeContentDocument,
  setContentDocumentFavorite,
  translateContentDocument,
  updateContentFolder,
  setContentFolderCover,
  uploadContentDocument,
} = await import("./content-client");

beforeEach(() => {
  calls.length = 0;
  digestInputs.length = 0;
  queuedUpload = false;
  responseForTool = undefined;
  authState = {
    organization: { key: "org-authenticated" },
    scope: { key: "scope-authenticated" },
    contentExecution: { agentKey: "agent-authenticated" },
  };
});

test("sends document and folder mutations with the authenticated Archive context", async () => {
  await createContentDocument("Plan", "Initial plan", "parent", "create-key");
  await saveContentDocument("document", "Updated plan", "2026-08-10T00:00:00.000Z");
  await createContentFolder("Work", "parent", "Active projects");

  expect(calls.map(({ url }) => url)).toEqual([
    "/api/v1/content/tools/document.create",
    "/api/v1/content/tools/document.update",
    "/api/v1/content/tools/folder.create",
  ]);
  expect(calls.every(({ body }) => body.organizationKey === "org-authenticated" && body.agentKey === "agent-authenticated")).toBe(true);
  expect(calls[0]?.body.input).toEqual({
    scopeKey: "scope-authenticated",
    folderKey: "parent",
    name: "Plan",
    representation: { content: "Initial plan" },
    idempotencyKey: "create-key",
  });
  expect(calls[1]?.body.input.updates[0]).toMatchObject({ documentKey: "document", content: "Updated plan", expectedUpdatedAt: "2026-08-10T00:00:00.000Z" });
  expect(calls[1]?.body.input.updates[0].createVersion).toBe(false);
  expect(calls[2]?.body.input.folders[0]).toEqual({ scopeKey: "scope-authenticated", parentFolderKey: "parent", name: "Work", description: "Active projects" });
});

test("uploads documents through the authenticated Archive context", async () => {
  await uploadContentDocument({ name: "notes.txt", type: "text/plain", size: 3, base64: "YWJj" }, "folder");

  expect(calls[0]?.body).toMatchObject({
    organizationKey: "org-authenticated",
    agentKey: "agent-authenticated",
    input: {
      scopeKey: "scope-authenticated",
      folderKey: "folder",
      file: { filename: "notes.txt", mimeType: "text/plain", sizeBytes: 3, encoding: "base64", content: "YWJj" },
    },
  });
  expect(calls[0]?.config.timeout).toBe(5 * 60_000);
  expect(calls[0]?.body.input.idempotencyKey).toBe("upload-upload-digest-upload-digest-folder");
  expect(digestInputs).toEqual(["YWJj", "notes.txt\0text/plain"]);
});

test("polls an offloaded upload using the same authenticated Archive context", async () => {
  queuedUpload = true;
  const result = await uploadContentDocument({ name: "notes.txt", type: "", size: 3, base64: "YWJj" }, "folder");
  expect(result.document.key).toBe("document");
  expect(calls.map(({ url }) => url)).toEqual([
    "/api/v1/content/tools/document.parse",
    `/api/v1/content/document-jobs/${"a".repeat(64)}`,
  ]);
  expect(calls[0]?.body.input.file.mimeType).toBe("text/plain");
  expect(calls[1]?.body).toEqual({ organizationKey: "org-authenticated", agentKey: "agent-authenticated" });
});

test("normalizes platform PDF MIME aliases and missing filename extensions", async () => {
  await uploadContentDocument({ name: "Quarterly report", type: "application/x-pdf; charset=binary", size: 8, base64: "JVBERi0=" }, "folder");
  expect(calls[0]?.body.input.file).toMatchObject({ filename: "Quarterly report.pdf", mimeType: "application/pdf" });
  expect(digestInputs).toEqual(["JVBERi0=", "Quarterly report.pdf\0application/pdf"]);
});

test("sends exact document action payloads and returns their results", async () => {
  responseForTool = (tool) => {
    if (tool === "document.download") return { data: { success: true, data: { results: [{ success: true, data: { documentKey: "document", format: "original", fileName: "Note.pdf", mimeType: "application/pdf", encoding: "base64", content: "cGRm" } }] } } };
    if (["document.rename", "document.move", "document.copy", "document.update"].includes(tool)) {
      return { data: { success: true, data: { results: [{ success: true, data: { document: { key: tool, name: "Note", isFavorite: true, updatedAt: "2026-08-10T00:01:00.000Z" } } }] } } };
    }
  };

  expect((await setContentDocumentFavorite("document", true)).isFavorite).toBe(true);
  expect((await renameContentDocument("document", "Renamed")).key).toBe("document.rename");
  expect((await moveContentDocument("document", "destination")).key).toBe("document.move");
  expect((await copyContentDocument("document", "nested-destination")).key).toBe("document.copy");
  expect((await downloadContentDocument("document")).fileName).toBe("Note.pdf");

  expect(calls.map(({ url }) => url)).toEqual([
    "/api/v1/content/tools/document.update",
    "/api/v1/content/tools/document.rename",
    "/api/v1/content/tools/document.move",
    "/api/v1/content/tools/document.copy",
    "/api/v1/content/tools/document.download",
  ]);
  expect(calls[0]?.body.input).toEqual({ updates: [{ documentKey: "document", isFavorite: true }], atomic: false, idempotencyKey: expect.any(String) });
  expect(calls[1]?.body.input).toEqual({ renames: [{ documentKey: "document", name: "Renamed" }], atomic: false, idempotencyKey: expect.any(String) });
  expect(calls[2]?.body.input).toEqual({ moves: [{ documentKey: "document", targetScopeKey: "scope-authenticated", targetFolderKey: "destination" }], atomic: false, idempotencyKey: expect.any(String) });
  expect(calls[3]?.body.input).toEqual({
    copies: [{ documentKey: "document", targetScopeKey: "scope-authenticated", targetFolderKey: "nested-destination", includeVersions: false, includeShares: false }],
    atomic: false,
    idempotencyKey: expect.any(String),
  });
  expect(calls[4]?.body.input).toEqual({ documentKeys: ["document"], format: "original" });
});

test("updates folder details and moves folders with exact payloads", async () => {
  responseForTool = (tool) => ["folder.update", "folder.move"].includes(tool)
    ? { data: { success: true, data: { results: [{ success: true, data: { folder: { key: "folder", name: "Plans", description: "Current plans" } } }] } } }
    : undefined;

  expect((await updateContentFolder("folder", "Plans", "Current plans")).description).toBe("Current plans");
  expect((await moveContentFolder("folder", "parent")).key).toBe("folder");
  expect(calls[0]?.body.input).toEqual({ updates: [{ folderKey: "folder", name: "Plans", description: "Current plans" }], atomic: false, idempotencyKey: expect.any(String) });
  expect(calls[1]?.body.input).toEqual({ moves: [{ folderKey: "folder", targetParentFolderKey: "parent" }], atomic: false, idempotencyKey: expect.any(String) });
});

test("sets and clears folder covers with exact payloads", async () => {
  responseForTool = () => ({ data: { success: true, data: { results: [{ success: true, data: { folder: { key: "folder", name: "Plans" } } }] } } });
  await setContentFolderCover("folder", "image");
  await setContentFolderCover("folder", null);
  expect(calls[0]?.body.input).toEqual({ updates: [{ folderKey: "folder", coverImageKey: "image" }], atomic: false, idempotencyKey: expect.any(String) });
  expect(calls[1]?.body.input).toEqual({ updates: [{ folderKey: "folder", coverImageKey: null }], atomic: false, idempotencyKey: expect.any(String) });
});

test("runs note autocomplete, enhancement, translation, and rename through document tools", async () => {
  responseForTool = (tool) => {
    if (tool === "autocomplete") return { data: { success: true, data: { completion: "next words" } } };
    if (tool === "enhance") return { data: { success: true, data: { content: "Improved note" } } };
    if (tool === "document.translate") return { data: { success: true, data: { results: [{ success: true, data: { text: "Nota", persistedDocumentKey: "document" } }] } } };
    if (tool === "document.rename") return { data: { success: true, data: { results: [{ success: true, data: { document: { key: "document", name: "Renamed note", isFavorite: false, updatedAt: "2026-08-10T00:02:00.000Z" } } }] } } };
  };

  expect(await autocompleteContent("Draft context", 8)).toEqual({ completion: "next words" });
  expect(await enhanceContent("Rough note")).toEqual({ content: "Improved note" });
  expect((await translateContentDocument("document", "Spanish")).persistedDocumentKey).toBe("document");
  expect((await renameContentDocument("document", "Renamed note")).name).toBe("Renamed note");
  expect(calls[0]?.body.input).toEqual({ context: "Draft context", wordCount: 8 });
  expect(calls[1]?.body.input).toEqual({ content: "Rough note" });
  expect(calls[2]?.body.input).toMatchObject({ documentKeys: ["document"], targetLanguage: "Spanish", preserveFormatting: true, mode: "replace" });
  expect(calls[3]?.body.input).toMatchObject({ renames: [{ documentKey: "document", name: "Renamed note" }], atomic: false });
});

test("sends Archive requests to the personal assistant surface", async () => {
  responseForTool = (tool) => tool === "respond" ? { data: { success: true, data: { type: "note", content: "Generated note", message: "Wrote the note.", sources: [] } } } : undefined;

  expect(await askPersonalAssistant("Write a launch plan", { documentKey: "document", title: "Untitled note", content: "Draft", selection: { start: 0, end: 5 } }, "folder")).toEqual({ type: "note", content: "Generated note", message: "Wrote the note.", sources: [] });
  expect(calls[0]?.url).toBe("/api/v1/assistant/respond");
  expect(calls[0]?.body).toEqual({
    organizationKey: "org-authenticated",
    agentKey: "agent-authenticated",
    input: { surface: "knowledge-workspace", message: "Write a launch plan", currentNote: { documentKey: "document", title: "Untitled note", content: "Draft", selection: { start: 0, end: 5 } }, requestKey: expect.any(String), folderKey: "folder" },
  });
});

test("loads version snapshot content before restoration", async () => {
  responseForTool = (tool) => tool === "document.find-version" ? { data: { success: true, data: { results: [{ success: true, data: { version: { key: "version", documentKey: "document", version: 1, createdAt: "2026-08-10T00:00:00.000Z", content: "Earlier text" } } }] } } } : undefined;

  expect((await findContentDocumentVersion("version")).content).toBe("Earlier text");
  expect(calls[0]?.body.input).toEqual({ versionKeys: ["version"], include: ["content"] });
});

test("can preserve the previous note as a version during an AI autosave", async () => {
  await saveContentDocument("document", "AI-revised note", "2026-08-10T00:00:00.000Z", true);
  expect(calls[0]?.body.input.updates[0]).toEqual({
    documentKey: "document",
    content: "AI-revised note",
    createVersion: true,
    expectedUpdatedAt: "2026-08-10T00:00:00.000Z",
  });
});

test("scopes search and replayable history to a folder", async () => {
  const documents = [{ documentKey: "document", name: "Note", score: 0.9, summary: "Relevant note", folderKey: "folder" }];
  responseForTool = (tool) => tool === "scope.content.search"
    ? { data: { success: true, data: { query: "roadmap", cached: false, folders: [], documents } } }
    : { data: { success: true, data: { history: [{ query: "roadmap", normalizedQuery: "roadmap", searchedAt: "2026-08-10T00:00:00.000Z", count: 2, documents }] } } };

  expect((await searchContent("roadmap", "folder", true)).documents).toEqual(documents);
  expect((await listContentSearchHistory("folder", true))[0]?.documents).toEqual(documents);
  expect(calls[0]?.body.input).toEqual({ scopeKey: "scope-authenticated", query: "roadmap", minimumScore: 0.55, folderKey: "folder", includeDescendants: true });
  expect(calls[1]?.body.input).toEqual({ scopeKey: "scope-authenticated", folderKey: "folder", includeDescendants: true, limit: 8 });
});

test("runs fast top-ten semantic search without a score threshold and summarizes on demand", async () => {
  responseForTool = (tool) => tool === "scope.document.search"
    ? { data: { success: true, data: { query: "roadmap", results: [{ documentKey: "document", scopeKey: "scope-authenticated", name: "Roadmap", score: 0.12 }] } } }
    : { data: { success: true, data: { results: [{ success: true, data: { text: "A concise roadmap summary." } }] } } };

  expect(await searchContentMatches("roadmap")).toHaveLength(1);
  expect(await summarizeContentDocument("document")).toBe("A concise roadmap summary.");
  expect(calls[0]?.body.input).toEqual({ scopeKey: "scope-authenticated", query: "roadmap", topK: 10 });
  expect(calls[0]?.body.input).not.toHaveProperty("minimumScore");
  expect(calls[1]?.body.input).toEqual({ documentKeys: ["document"], style: "brief", persist: false });
});

test("loads an existing My Documents folder as the initial Archive location", async () => {
  responseForTool = (tool) => {
    if (tool === "folder.list") {
      const parentFolderKey = calls.at(-1)?.body.input.parentFolderKey;
      return { data: { success: true, data: { folders: parentFolderKey ? [{ key: "nested", parentFolderKey, name: "Projects" }] : [{ key: "my-documents", name: "My Documents" }] } } };
    }
    if (tool === "document.list") return { data: { success: true, data: { documents: [] } } };
  };

  const initial = await loadInitialContentLocation();

  expect(initial.initialFolder).toEqual({ key: "my-documents", name: "My Documents" });
  expect(initial.root.folders).toEqual([{ key: "my-documents", name: "My Documents" }]);
  expect(initial.location.folders).toEqual([{ key: "nested", parentFolderKey: "my-documents", name: "Projects" }]);
  expect(calls.filter(({ url }) => url.endsWith("folder.list")).map(({ body }) => body.input.parentFolderKey)).toEqual([undefined, "my-documents"]);
});

test("keeps legacy accounts at the root when My Documents is absent", async () => {
  responseForTool = (tool) => tool === "folder.list"
    ? { data: { success: true, data: { folders: [{ key: "legacy", name: "Legacy" }] } } }
    : { data: { success: true, data: { documents: [{ key: "root-note", name: "Root note", isFavorite: false, updatedAt: "2026-08-10T00:00:00.000Z" }] } } };

  const initial = await loadInitialContentLocation();

  expect(initial.initialFolder).toBeUndefined();
  expect(initial.location).toBe(initial.root);
  expect(calls.filter(({ url }) => url.endsWith("folder.list"))).toHaveLength(1);
  expect(calls.filter(({ url }) => url.endsWith("document.list"))).toHaveLength(1);
});

test("surfaces tool and item errors for document actions", async () => {
  responseForTool = (tool) => tool === "document.download"
    ? { data: { success: false, error: { message: "Download denied" } } }
    : { data: { success: true, data: { results: [{ success: false, error: { message: "Move denied" } }] } } };

  await expect(moveContentDocument("document", "folder")).rejects.toThrow("Move denied");
  await expect(downloadContentDocument("document")).rejects.toThrow("Download denied");
});

test("rejects Archive calls when authenticated context is incomplete", async () => {
  authState = { ...authState, contentExecution: { agentKey: "" } };

  await expect(createContentFolder("Work")).rejects.toThrow("Archive is unavailable for this session.");
  expect(calls).toHaveLength(0);
});
