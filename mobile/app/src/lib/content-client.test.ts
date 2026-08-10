import { beforeEach, expect, mock, test } from "bun:test";

const calls: { url: string; body: Record<string, any>; config: Record<string, any> }[] = [];
const testRuntime = globalThis as typeof globalThis & { __archiveApiPost?: (...input: any[]) => unknown };
let authState = {
  organization: { key: "org-authenticated" },
  scope: { key: "scope-authenticated" },
  contentExecution: { agentKey: "agent-authenticated" },
};

mock.module("@/state/auth", () => ({
  useAuthStore: { getState: () => authState },
}));
mock.module("./api-client", () => ({
  apiClient: {
    post: (...args: any[]) => testRuntime.__archiveApiPost?.(...args),
  },
}));

testRuntime.__archiveApiPost = async (url: string, body: Record<string, any>, config: Record<string, any>) => {
  calls.push({ url, body, config });
  const tool = url.split("/").at(-1);
  if (tool === "document.create" || tool === "document.parse") {
    return { data: { success: true, data: { document: { key: "document", name: "Note", updatedAt: "2026-08-10T00:00:00.000Z" } } } };
  }
  if (tool === "folder.create") {
    return { data: { success: true, data: { results: [{ success: true, data: { folder: { key: "folder", name: "Work" } } }] } } };
  }
  if (tool === "document.update") {
    return { data: { success: true, data: { results: [{ success: true, data: { document: { key: "document", name: "Note", updatedAt: "2026-08-10T00:01:00.000Z" } } }] } } };
  }
  throw new Error(`Unexpected tool: ${tool}`);
};

const {
  createContentDocument,
  createContentFolder,
  saveContentDocument,
  uploadContentDocument,
} = await import("./content-client");

beforeEach(() => {
  calls.length = 0;
  authState = {
    organization: { key: "org-authenticated" },
    scope: { key: "scope-authenticated" },
    contentExecution: { agentKey: "agent-authenticated" },
  };
});

test("sends document and folder mutations with the authenticated Archive context", async () => {
  await createContentDocument("Plan", "Initial plan", "parent", "create-key");
  await saveContentDocument("document", "Updated plan", "2026-08-10T00:00:00.000Z");
  await createContentFolder("Work", "parent");

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
  expect(calls[2]?.body.input.folders[0]).toEqual({ scopeKey: "scope-authenticated", parentFolderKey: "parent", name: "Work" });
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
});

test("rejects Archive calls when authenticated context is incomplete", async () => {
  authState = { ...authState, contentExecution: { agentKey: "" } };

  await expect(createContentFolder("Work")).rejects.toThrow("Archive is unavailable for this session.");
  expect(calls).toHaveLength(0);
});
