import { beforeEach, expect, mock, test } from "bun:test";

const calls: { url: string; body: Record<string, any>; config: Record<string, any> }[] = [];
const testRuntime = globalThis as typeof globalThis & { __archiveApiPost?: (...input: any[]) => unknown };
let authState = {
  organization: { key: "org-authenticated" },
  scope: { key: "scope-authenticated" },
  contentExecution: { agentKey: "agent-authenticated" },
};
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
  const response = responseForTool?.(tool ?? "");
  if (response) return response;
  if (tool === "document.create" || tool === "document.parse" || tool === "document.scan") {
    return { data: { success: true, data: { document: { key: "document", name: "Note", isFavorite: false, updatedAt: "2026-08-10T00:00:00.000Z" } } } };
  }
  if (tool === "folder.create") {
    return { data: { success: true, data: { results: [{ success: true, data: { folder: { key: "folder", name: "Work" } } }] } } };
  }
  if (tool === "document.update" || tool === "document.archive") {
    return { data: { success: true, data: { results: [{ success: true, data: { document: { key: "document", name: "Note", isFavorite: false, updatedAt: "2026-08-10T00:01:00.000Z" } } }] } } };
  }
  throw new Error(`Unexpected tool: ${tool}`);
};

const {
  archiveContentDocument,
  archiveContentSelection,
  askPersonalAssistant,
  clearContentDocumentAudioPlayback,
  createContentDocument,
  createContentDocumentVersion,
  createContentFolder,
  copyContentDocument,
  copyContentSelection,
  deleteContentSearchHistory,
  downloadContentDocument,
  enhanceContentDocument,
  findContentDocumentSummary,
  findContentDocumentVersion,
  findContentNeighbors,
  generateContentDocumentAudio,
  generateContentDocumentSummaryAudio,
  getContentContext,
  getContentDocumentTopics,
  loadInitialContentLocation,
  listContentSearchHistory,
  listContentDocumentAudioVersions,
  listContentDocumentSummaries,
  moveContentFolder,
  moveContentDocument,
  moveContentSelection,
  readContentDocument,
  readContentDocumentSources,
  renameContentDocument,
  restoreContentDocumentVersion,
  saveContentDocument,
  scanContentDocument,
  searchContent,
  searchContentMatches,
  summarizeContentDocument,
  setContentDocumentFavorite,
  setContentSelectionFavorite,
  translateContentDocument,
  updateContentDocumentAudioPlayback,
  updateContentFolder,
  setContentFolderCover,
  uploadContentDocument,
} = await import("./content-client");

beforeEach(() => {
  calls.length = 0;
  digestInputs.length = 0;
  responseForTool = undefined;
  authState = {
    organization: { key: "org-authenticated" },
    scope: { key: "scope-authenticated" },
    contentExecution: { agentKey: "agent-authenticated" },
  };
});

test("loads extracted text for uploaded files", async () => {
  responseForTool = (tool) => tool === "document.find" ? { data: { success: true, data: { results: [{ success: true, data: { document: { key: "document", name: "Brief.pdf", extension: "pdf", mimeType: "application/pdf", isFavorite: false, updatedAt: "2026-08-10T00:00:00.000Z", content: "Brief" } } }] } } } : undefined;

  await expect(readContentDocument("document")).resolves.toMatchObject({ content: "Brief", extension: "pdf" });
  expect(calls[0]?.body.input).toEqual({ documentKeys: ["document"], include: ["content"] });
});

test("generates and lists independent full-audio versions", async () => {
  const metadata = { key: "audio-version", documentKey: "document", version: 2, sourceContentHash: "a".repeat(64), sourceTitle: "Note", sourceDocumentUpdatedAt: "2026-08-10T00:00:00.000Z", mimeType: "audio/mpeg", sizeBytes: 1024, durationMs: 65_000, isCurrent: false, playbackPositionMs: 0, includeTitle: false, includeCode: false, createdAt: "2026-08-10T00:02:00.000Z" };
  responseForTool = (tool) => tool === "document.read"
    ? { data: { success: true, data: { results: [{ success: true, data: { audioVersion: metadata } }] } } }
    : tool === "document.list-audio-versions"
      ? { data: { success: true, data: { results: [{ success: true, data: { audioVersions: [{ ...metadata, current: true, url: "https://audio.example/version.mp3" }] } }] } } }
      : undefined;

  await expect(generateContentDocumentAudio("document")).resolves.toMatchObject({ key: "audio-version", version: 2 });
  await expect(listContentDocumentAudioVersions("document")).resolves.toMatchObject([{ key: "audio-version", current: true }]);
  expect(calls[0]?.body.input).toMatchObject({ documentKeys: ["document"], mode: "audio", persistAudio: true, voice: "Matthew" });
  expect(calls[0]?.config.timeout).toBe(15 * 60_000);
  expect(calls[1]?.body.input).toEqual({ documentKeys: ["document"], cursor: undefined, limit: 100 });
});

test("updates and clears persisted document audio playback state", async () => {
  responseForTool = (tool) => tool === "document.audio.playback.update"
    ? { data: { success: true, data: { audioVersionKey: "audio-version", documentKey: "document", playbackPositionMs: 12_345 } } }
    : tool === "document.audio.playback.clear"
      ? { data: { success: true, data: { documentKey: "document" } } }
      : undefined;

  await expect(updateContentDocumentAudioPlayback("audio-version", 12_345)).resolves.toMatchObject({ playbackPositionMs: 12_345 });
  await expect(clearContentDocumentAudioPlayback("document")).resolves.toEqual({ documentKey: "document" });
  expect(calls.map(({ url }) => url)).toEqual([
    "/api/v1/content/tools/document.audio.playback.update",
    "/api/v1/content/tools/document.audio.playback.clear",
  ]);
  expect(calls[0]?.body.input).toMatchObject({ audioVersionKey: "audio-version", playbackPositionMs: 12_345 });
  expect(calls[1]?.body.input).toMatchObject({ documentKey: "document" });
  expect(calls.every(({ body }) => typeof body.input.idempotencyKey === "string")).toBe(true);
});

test("generates durable summary audio through the content tool", async () => {
  const audio = { key: "summary-audio", summaryKey: "summary", mimeType: "audio/mpeg", sizeBytes: 512, durationMs: 12_000, createdAt: "2026-08-10T00:03:00.000Z", url: "https://audio.example/summary.mp3" };
  responseForTool = (tool) => tool === "document.summary.audio.generate"
    ? { data: { success: true, data: { results: [{ success: true, data: { audio } }] } } }
    : undefined;

  await expect(generateContentDocumentSummaryAudio("summary")).resolves.toEqual(audio);
  expect(calls[0]?.body.input).toMatchObject({ summaryKeys: ["summary"], voice: "Matthew" });
  expect(calls[0]?.body.input.idempotencyKey).toBeString();
  expect(calls[0]?.config.timeout).toBe(15 * 60_000);
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
    content: "Initial plan",
    idempotencyKey: "create-key",
  });
  expect(calls[1]?.body.input.updates[0]).toMatchObject({ documentKey: "document", content: "Updated plan", expectedUpdatedAt: "2026-08-10T00:00:00.000Z" });
  expect(calls[1]?.body.input.updates[0].createVersion).toBe(false);
  expect(calls[2]?.body.input.folders[0]).toEqual({ scopeKey: "scope-authenticated", parentFolderKey: "parent", name: "Work", description: "Active projects" });
});

test("uploads documents through the authenticated Archive context", async () => {
  await uploadContentDocument({ name: "notes.txt", type: "text/plain", size: 3, base64: "YWJj" }, "folder", getContentContext(), "upload-attempt");

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
  expect(calls[0]?.body.input.idempotencyKey).toBe("upload-attempt");
});

test("treats repeated selections of the same file as separate uploads", async () => {
  const file = { name: "notes.txt", type: "text/plain", size: 3, base64: "YWJj" };
  await uploadContentDocument(file, "folder");
  await uploadContentDocument(file, "folder");

  expect(calls[0]?.body.input.idempotencyKey).not.toBe(calls[1]?.body.input.idempotencyKey);
});

test("submits ordered scan pages as one editable Archive document", async () => {
  await scanContentDocument([{ name: "one.jpg", size: 4, base64: "/9j/2Q==" }, { name: "two.jpg", size: 4, base64: "/9j/2Q==" }], "folder", getContentContext(), "Scanned report");
  expect(calls[0]?.url).toBe("/api/v1/content/tools/document.scan");
  expect(calls[0]?.body.input).toMatchObject({
    scopeKey: "scope-authenticated",
    folderKey: "folder",
    name: "Scanned report",
    pages: [
      { filename: "one.jpg", mimeType: "image/jpeg", sizeBytes: 4, encoding: "base64", content: "/9j/2Q==" },
      { filename: "two.jpg", mimeType: "image/jpeg", sizeBytes: 4, encoding: "base64", content: "/9j/2Q==" },
    ],
  });
  expect(calls[0]?.body.input.idempotencyKey).toBe("scan-upload-digest-folder");
});

test("reads authorized scanned source images without requesting storage keys", async () => {
  responseForTool = () => ({ data: { success: true, data: { results: [{ success: true, data: { document: { key: "document", name: "Scan", isFavorite: false, updatedAt: "2026-08-10T00:00:00.000Z", sourceImages: [{ page: 1, url: "https://images.example/1" }] } } }] } } });
  await expect(readContentDocumentSources("document")).resolves.toEqual([{ page: 1, url: "https://images.example/1" }]);
  expect(calls[0]?.body.input).toEqual({ documentKeys: ["document"], include: ["sourceImages"] });
});

test("archives notes and uploaded files through the same document lifecycle", async () => {
  await archiveContentDocument("document");
  expect(calls[0]?.url).toBe("/api/v1/content/tools/document.archive");
  expect(calls[0]?.body.input).toMatchObject({ documentKeys: ["document"], atomic: false });
});

test("normalizes platform PDF MIME aliases without changing the picker filename", async () => {
  await uploadContentDocument({ name: "Quarterly Report FINAL.PDF", type: "application/x-pdf; charset=binary", size: 8, base64: "JVBERi0=" }, "folder");
  expect(calls[0]?.body.input.file).toMatchObject({ filename: "Quarterly Report FINAL.PDF", mimeType: "application/pdf" });
});

test("requests sandboxed HTML for in-app original previews", async () => {
  responseForTool = (tool) => tool === "document.download"
    ? { data: { success: true, data: { results: [{ success: true, data: { documentKey: "document", format: "html", fileName: "Report.html", mimeType: "text/html; charset=utf-8", encoding: "base64", content: "PGh0bWw+PC9odG1sPg==" } }] } } }
    : undefined;
  await expect(downloadContentDocument("document", "html")).resolves.toMatchObject({ format: "html", fileName: "Report.html" });
  expect(calls[0]?.body.input).toEqual({ documentKeys: ["document"], format: "html" });
});

test("adds a provider-omitted extension without replacing the picker filename", async () => {
  await uploadContentDocument({ name: "Quarterly report", type: "application/pdf", size: 8, base64: "JVBERi0=" }, "folder");
  expect(calls[0]?.body.input.file).toMatchObject({ filename: "Quarterly report.pdf", mimeType: "application/pdf" });
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

test("executes mixed batches with exact payloads and stable operation keys", async () => {
  responseForTool = (tool) => {
    if (tool.startsWith("folder.")) return { data: { success: true, data: { results: [{ success: true, data: { folder: { key: "folder-a", name: "Folder", isFavorite: true } } }] } } };
    return { data: { success: true, data: { results: [{ success: true, data: { document: { key: "document-a", name: "Document", isFavorite: true, updatedAt: "after" } } }] } } };
  };

  const result = await setContentSelectionFavorite({ folderKeys: ["folder-a"], documentKeys: ["document-a"] }, true, "stable-favorite");
  expect(result).toMatchObject({ requested: 2, succeeded: 2, failed: 0, folders: [{ key: "folder-a" }], documents: [{ key: "document-a" }], failures: [] });
  expect(calls.map(({ url, body }) => ({ url, input: body.input }))).toEqual([
    { url: "/api/v1/content/tools/folder.update", input: { updates: [{ folderKey: "folder-a", isFavorite: true }], atomic: false, idempotencyKey: "stable-favorite:folder.update" } },
    { url: "/api/v1/content/tools/document.update", input: { updates: [{ documentKey: "document-a", isFavorite: true }], atomic: false, idempotencyKey: "stable-favorite:document.update" } },
  ]);
});

test("returns copied records and surfaces item and tool partial failures", async () => {
  responseForTool = (tool) => {
    if (tool === "folder.copy") return { data: { success: true, data: { results: [
      { success: true, data: { folder: { key: "folder-copy", name: "Folder copy" }, folderCount: 3, documentCount: 4 } },
      { success: false, error: { message: "Folder destination denied" } },
    ] } } };
    if (tool === "document.copy") throw new Error("Document copy unavailable");
  };

  const result = await copyContentSelection(
    { folderKeys: ["folder-a"], documentKeys: ["document-a"] },
    ["destination-a", "destination-b"],
    "stable-copy",
  );
  expect(result.copiedFolders).toEqual([{ folder: { key: "folder-copy", name: "Folder copy" }, folderCount: 3, documentCount: 4 }]);
  expect(result).toMatchObject({ requested: 4, succeeded: 1, failed: 3 });
  expect(result.failures).toEqual([
    { kind: "folder", key: "folder-a", destinationFolderKey: "destination-b", tool: "folder.copy", message: "Folder destination denied" },
    { kind: "document", key: "document-a", destinationFolderKey: "destination-a", tool: "document.copy", message: "Document copy unavailable" },
    { kind: "document", key: "document-a", destinationFolderKey: "destination-b", tool: "document.copy", message: "Document copy unavailable" },
  ]);
  expect(calls[0]?.body.input.idempotencyKey).toBe("stable-copy:folder.copy");
  expect(calls[1]?.body.input.idempotencyKey).toBe("stable-copy:document.copy");
});

test("moves and archives mixed selections through separate canonical tools", async () => {
  responseForTool = (tool) => ({ data: { success: true, data: { results: [{ success: true, data: tool.startsWith("folder.")
    ? { folder: { key: "folder-a", name: "Folder" } }
    : { document: { key: "document-a", name: "Document", isFavorite: false, updatedAt: "after" } } }] } } });

  await moveContentSelection({ folderKeys: ["folder-a"], documentKeys: ["document-a"] }, "destination", "stable-move");
  await archiveContentSelection({ folderKeys: ["folder-a"], documentKeys: ["document-a"] }, "stable-archive");
  expect(calls.map(({ url }) => url)).toEqual([
    "/api/v1/content/tools/folder.move", "/api/v1/content/tools/document.move",
    "/api/v1/content/tools/folder.archive", "/api/v1/content/tools/document.archive",
  ]);
  expect(calls[0]?.body.input).toEqual({ moves: [{ folderKey: "folder-a", targetParentFolderKey: "destination" }], atomic: false, idempotencyKey: "stable-move:folder.move" });
  expect(calls[1]?.body.input).toEqual({ moves: [{ documentKey: "document-a", targetScopeKey: "scope-authenticated", targetFolderKey: "destination" }], atomic: false, idempotencyKey: "stable-move:document.move" });
  expect(calls[2]?.body.input).toEqual({ folderKeys: ["folder-a"], includeDescendants: true, atomic: false, idempotencyKey: "stable-archive:folder.archive" });
  expect(calls[3]?.body.input).toEqual({ documentKeys: ["document-a"], atomic: false, idempotencyKey: "stable-archive:document.archive" });
});

test("sets and clears folder covers with exact payloads", async () => {
  responseForTool = () => ({ data: { success: true, data: { results: [{ success: true, data: { folder: { key: "folder", name: "Plans" } } }] } } });
  await setContentFolderCover("folder", "image");
  await setContentFolderCover("folder", null);
  expect(calls[0]?.body.input).toEqual({ updates: [{ folderKey: "folder", coverImageKey: "image" }], atomic: false, idempotencyKey: expect.any(String) });
  expect(calls[1]?.body.input).toEqual({ updates: [{ folderKey: "folder", coverImageKey: null }], atomic: false, idempotencyKey: expect.any(String) });
});

test("runs note enhancement, translation, and rename through document tools", async () => {
  responseForTool = (tool) => {
    if (tool === "document.enhance") return { data: { success: true, data: { results: [{ success: true, data: { text: "Improved note", persistedDocumentKey: "document" } }] } } };
    if (tool === "document.translate") return { data: { success: true, data: { results: [{ success: true, data: { text: "Nota", persistedDocumentKey: "document" } }] } } };
    if (tool === "document.create-version") return { data: { success: true, data: { results: [{ success: true, data: { version: { key: "version", documentKey: "document", version: 2, label: "Enhanced version", createdAt: "2026-08-10T00:03:00.000Z" } } }] } } };
    if (tool === "document.rename") return { data: { success: true, data: { results: [{ success: true, data: { document: { key: "document", name: "Renamed note", isFavorite: false, updatedAt: "2026-08-10T00:02:00.000Z" } } }] } } };
  };

  expect((await enhanceContentDocument("document", "Improve clarity")).text).toBe("Improved note");
  expect((await translateContentDocument("document", "Spanish")).persistedDocumentKey).toBe("document");
  expect((await createContentDocumentVersion("document", "Enhanced version", "Generated copy", "enhancement")).label).toBe("Enhanced version");
  expect((await renameContentDocument("document", "Renamed note")).name).toBe("Renamed note");
  expect(calls[0]?.body.input).toEqual({ documentKeys: ["document"], instruction: "Improve clarity", mode: "preview" });
  expect(calls[1]?.body.input).toMatchObject({ documentKeys: ["document"], targetLanguage: "Spanish", preserveFormatting: true, mode: "replace" });
  expect(calls[2]?.body.input).toMatchObject({ documentKeys: ["document"], labels: { document: "Enhanced version" }, contents: { document: "Generated copy" }, types: { document: "enhancement" } });
  expect(calls[3]?.body.input).toMatchObject({ renames: [{ documentKey: "document", name: "Renamed note" }], atomic: false });
});

test("restores a document version without a backup when requested", async () => {
  responseForTool = () => ({ data: { success: true, data: { results: [{ success: true, data: { document: { key: "document", name: "Note", content: "Version content", isFavorite: false, updatedAt: "2026-08-10T00:04:00.000Z" } } }] } } });

  await restoreContentDocumentVersion("document", "version", false);

  expect(calls[0]?.body.input).toMatchObject({ restores: [{ documentKey: "document", versionKey: "version", createBackupVersion: false }] });
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
    : { data: { success: true, data: { history: [{ query: "roadmap", normalizedQuery: "roadmap", contextDomain: "content", searchedAt: "2026-08-10T00:00:00.000Z", usageCount: 2, documents }] } } };

  expect((await searchContent("roadmap", "folder", true)).documents).toEqual(documents);
  expect((await listContentSearchHistory("folder", true))[0]?.documents).toEqual(documents);
  expect(calls[0]?.body.input).toEqual({ scopeKey: "scope-authenticated", query: "roadmap", minimumScore: 0.55, folderKey: "folder", includeDescendants: true });
  expect(calls[1]?.body.input).toEqual({ scopeKey: "scope-authenticated", folderKey: "folder", includeDescendants: true, limit: 100 });
});

test("deletes one folder-scoped Content search-history entry", async () => {
  responseForTool = () => ({ data: { success: true, data: { normalizedQuery: "roadmap", deleted: true } } });

  await expect(deleteContentSearchHistory("roadmap", "folder", true)).resolves.toEqual({ normalizedQuery: "roadmap", deleted: true });
  expect(calls[0]?.body.input).toMatchObject({ scopeKey: "scope-authenticated", normalizedQuery: "roadmap", folderKey: "folder", includeDescendants: true });
  expect(calls[0]?.body.input.idempotencyKey).toBeString();
});

test("runs fast combined search without summaries", async () => {
  responseForTool = () => ({ data: { success: true, data: { query: "roadmap", cached: false, folders: [{ key: "folder", scopeKey: "scope-authenticated", name: "Roadmaps", score: 0.8 }], documents: [{ documentKey: "document", scopeKey: "scope-authenticated", name: "Roadmap", extension: "docx", score: 0.72 }] } } });

  expect(await searchContentMatches("roadmap")).toMatchObject({ folders: [{ key: "folder" }], documents: [{ documentKey: "document", extension: "docx" }] });
  expect(calls[0]?.body.input).toEqual({ scopeKey: "scope-authenticated", query: "roadmap", includeSummaries: false, minimumScore: 0.55 });
});

test("can search without recording history", async () => {
  responseForTool = () => ({ data: { success: true, data: { query: "roadmap", cached: false, folders: [], documents: [] } } });

  await searchContentMatches("roadmap", undefined, undefined, false);
  expect(calls[0]?.body.input).toMatchObject({ query: "roadmap", recordHistory: false });
});

test("finds semantic neighbors from exactly one Content source", async () => {
  const neighbors = { folders: [{ key: "folder", name: "Related" }], documents: [], files: [] };
  responseForTool = (tool) => tool === "content.neighbors" ? { data: { success: true, data: neighbors } } : undefined;

  await expect(findContentNeighbors({ documentKey: "document" })).resolves.toEqual(neighbors);
  expect(calls[0]?.url).toContain("/content.neighbors");
  expect(calls[0]?.body.input).toEqual({ documentKey: "document" });
});

test("generates topics and persists, lists, and opens summary versions", async () => {
  const summary = { key: "summary", documentKey: "document", version: 1, summary: "A concise roadmap summary.", topic: "Launch plan", style: "brief", sourceContentHash: "a".repeat(64), sourceTitle: "Roadmap", sourceDocumentUpdatedAt: "2026-08-10T00:00:00.000Z", createdAt: "2026-08-10T00:01:00.000Z" };
  responseForTool = (tool) => tool === "document.topics"
    ? { data: { success: true, data: { documentKey: "document", topics: ["Launch plan", "Risks"] } } }
    : tool === "document.summarize"
      ? { data: { success: true, data: { results: [{ success: true, data: { text: summary.summary, summary } }] } } }
      : tool === "document.list-summaries"
        ? { data: { success: true, data: { results: [{ success: true, data: { summaries: [summary] } }] } } }
        : { data: { success: true, data: { results: [{ success: true, data: { summary } }] } } };

  await expect(getContentDocumentTopics("document")).resolves.toEqual(["Launch plan", "Risks"]);
  await expect(summarizeContentDocument("document", "Launch plan")).resolves.toEqual(summary);
  await expect(listContentDocumentSummaries("document")).resolves.toEqual([summary]);
  await expect(findContentDocumentSummary("summary")).resolves.toEqual(summary);
  expect(calls[0]?.body.input).toEqual({ documentKey: "document" });
  expect(calls[1]?.body.input).toMatchObject({ documentKeys: ["document"], topic: "Launch plan", style: "brief", persist: true, idempotencyKey: expect.any(String) });
  expect(calls[2]?.body.input).toEqual({ documentKeys: ["document"], cursor: undefined, limit: 100 });
  expect(calls[3]?.body.input).toEqual({ summaryKeys: ["summary"] });
});

test("scopes fast semantic search to a folder and its descendants", async () => {
  responseForTool = () => ({ data: { success: true, data: { query: "roadmap", cached: false, folders: [], documents: [] } } });
  await searchContentMatches("roadmap", undefined, "folder");
  expect(calls[0]?.body.input).toEqual({
    scopeKey: "scope-authenticated",
    query: "roadmap",
    includeSummaries: false,
    minimumScore: 0.55,
    folderKey: "folder",
    includeDescendants: true,
  });
});

test("loads an existing My Documents folder as the initial Archive location", async () => {
  responseForTool = (tool) => {
    if (tool === "folder.list") {
      return { data: { success: true, data: { folders: [
        { key: "my-documents", name: "My Documents" },
        { key: "nested", parentFolderKey: "my-documents", name: "Projects" },
      ] } } };
    }
    if (tool === "document.list") return { data: { success: true, data: { documents: [] } } };
  };

  const initial = await loadInitialContentLocation();

  expect(initial.initialFolder).toEqual({ key: "my-documents", name: "My Documents" });
  expect(initial.root.folders).toEqual([{ key: "my-documents", name: "My Documents" }]);
  expect(initial.location.folders).toEqual([{ key: "nested", parentFolderKey: "my-documents", name: "Projects" }]);
  expect(calls.filter(({ url }) => url.endsWith("folder.list")).map(({ body }) => body.input.includeDescendants)).toEqual([true]);
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
