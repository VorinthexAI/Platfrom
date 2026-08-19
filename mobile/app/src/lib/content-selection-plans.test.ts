import { expect, test } from "bun:test";

import {
  MAX_CONTENT_BATCH_OPERATIONS,
  planContentSelectionDelete,
  planContentSelectionCopy,
  planContentSelectionFavorite,
  planContentSelectionMove,
} from "./content-selection-plans";

const selection = { folderKeys: ["folder-a", "folder-a", "folder-b"], documentKeys: ["document-a"] };

test("plans exact mixed favorite and move payloads with stable per-tool keys", () => {
  expect(planContentSelectionFavorite(selection, true, "favorite-request").calls.map(({ tool, input }) => ({ tool, input }))).toEqual([
    { tool: "folder.update", input: { updates: [{ folderKey: "folder-a", isFavorite: true }, { folderKey: "folder-b", isFavorite: true }], atomic: false, idempotencyKey: "favorite-request:folder.update" } },
    { tool: "document.update", input: { updates: [{ documentKey: "document-a", isFavorite: true }], atomic: false, idempotencyKey: "favorite-request:document.update" } },
  ]);
  expect(planContentSelectionMove(selection, "scope-a", undefined, "move-request").calls.map(({ tool, input }) => ({ tool, input }))).toEqual([
    { tool: "folder.move", input: { moves: [{ folderKey: "folder-a" }, { folderKey: "folder-b" }], atomic: false, idempotencyKey: "move-request:folder.move" } },
    { tool: "document.move", input: { moves: [{ documentKey: "document-a", targetScopeKey: "scope-a" }], atomic: false, idempotencyKey: "move-request:document.move" } },
  ]);
});

test("builds a source by destination copy cross-product in stable order", () => {
  const result = planContentSelectionCopy({ folderKeys: ["folder-a"], documentKeys: ["document-a", "document-b"] }, "scope-a", ["destination-a", "destination-b", "destination-a"], "copy-request");
  expect(result.operationCount).toBe(6);
  expect(result.calls.map(({ tool, input }) => ({ tool, input }))).toEqual([
    { tool: "folder.copy", input: { copies: [
      { folderKey: "folder-a", targetScopeKey: "scope-a", targetParentFolderKey: "destination-a" },
      { folderKey: "folder-a", targetScopeKey: "scope-a", targetParentFolderKey: "destination-b" },
    ], atomic: false, idempotencyKey: "copy-request:folder.copy" } },
    { tool: "document.copy", input: { copies: [
      { documentKey: "document-a", targetScopeKey: "scope-a", targetFolderKey: "destination-a", includeVersions: false, includeShares: false },
      { documentKey: "document-a", targetScopeKey: "scope-a", targetFolderKey: "destination-b", includeVersions: false, includeShares: false },
      { documentKey: "document-b", targetScopeKey: "scope-a", targetFolderKey: "destination-a", includeVersions: false, includeShares: false },
      { documentKey: "document-b", targetScopeKey: "scope-a", targetFolderKey: "destination-b", includeVersions: false, includeShares: false },
    ], atomic: false, idempotencyKey: "copy-request:document.copy" } },
  ]);
});

test("enforces copy limits per canonical tool rather than in aggregate", () => {
  const documentKeys = Array.from({ length: MAX_CONTENT_BATCH_OPERATIONS }, (_, index) => `document-${index}`);
  const allowed = planContentSelectionCopy({ folderKeys: ["folder"], documentKeys }, "scope", ["destination"], "copy");
  expect(allowed.operationCount).toBe(101);
  expect(allowed.calls.map(({ operations }) => operations.length)).toEqual([1, 100]);
  expect(() => planContentSelectionCopy({ folderKeys: [...documentKeys, "folder-100"], documentKeys: [] }, "scope", ["destination"], "copy")).toThrow("folder.copy operations cannot exceed 100");
  expect(() => planContentSelectionCopy({ folderKeys: [], documentKeys: [...documentKeys, "document-100"] }, "scope", ["destination"], "copy")).toThrow("document.copy operations cannot exceed 100");
});

test("enforces favorite, move, and archive bounds for each canonical tool", () => {
  const tooMany = Array.from({ length: MAX_CONTENT_BATCH_OPERATIONS + 1 }, (_, index) => `key-${index}`);
  expect(() => planContentSelectionFavorite({ folderKeys: tooMany, documentKeys: [] }, true, "favorite")).toThrow("folder.update operations cannot exceed 100");
  expect(() => planContentSelectionFavorite({ folderKeys: [], documentKeys: tooMany }, true, "favorite")).toThrow("document.update operations cannot exceed 100");
  expect(() => planContentSelectionMove({ folderKeys: tooMany, documentKeys: [] }, "scope", undefined, "move")).toThrow("folder.move operations cannot exceed 100");
  expect(() => planContentSelectionMove({ folderKeys: [], documentKeys: tooMany }, "scope", undefined, "move")).toThrow("document.move operations cannot exceed 100");
  expect(() => planContentSelectionDelete({ folderKeys: tooMany, documentKeys: [] }, "delete")).toThrow("folder.delete operations cannot exceed 100");
  expect(() => planContentSelectionDelete({ folderKeys: [], documentKeys: tooMany }, "delete")).toThrow("document.delete operations cannot exceed 100");
});

test("rejects empty destination keys without treating them as root", () => {
  expect(() => planContentSelectionMove({ folderKeys: ["folder"], documentKeys: [] }, "scope", "", "move")).toThrow("destination keys cannot be empty");
  expect(() => planContentSelectionCopy({ folderKeys: [], documentKeys: ["document"] }, "scope", ["   "], "copy")).toThrow("destination keys cannot be empty");
  expect(planContentSelectionCopy({ folderKeys: [], documentKeys: ["document"] }, "scope", [undefined], "copy").operationCount).toBe(1);
});

test("deterministically bounds per-tool keys derived from any valid caller key", () => {
  const callerKey = "request-".repeat(25);
  const first = planContentSelectionFavorite({ folderKeys: ["folder"], documentKeys: ["document"] }, true, callerKey);
  const second = planContentSelectionFavorite({ folderKeys: ["folder"], documentKeys: ["document"] }, true, callerKey);
  const keys = first.calls.map(({ input }) => input.idempotencyKey as string);
  expect(keys).toEqual(second.calls.map(({ input }) => input.idempotencyKey));
  expect(keys.every((key) => key.length <= 200)).toBe(true);
  expect(keys[0]).not.toBe(keys[1]);
  expect(planContentSelectionDelete({ folderKeys: ["folder"], documentKeys: [] }, "short-key").calls[0]?.input.idempotencyKey).toBe("short-key:folder.delete");
});

test("plans descendant folder archive separately from document archive", () => {
  expect(planContentSelectionDelete(selection, "delete-request").calls.map(({ tool, input }) => ({ tool, input }))).toEqual([
    { tool: "folder.delete", input: { folderKeys: ["folder-a", "folder-b"], recursive: true, atomic: false, idempotencyKey: "delete-request:folder.delete" } },
    { tool: "document.delete", input: { documentKeys: ["document-a"], atomic: false, idempotencyKey: "delete-request:document.delete" } },
  ]);
});
