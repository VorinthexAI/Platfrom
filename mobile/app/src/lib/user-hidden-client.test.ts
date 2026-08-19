import { beforeEach, expect, mock, test } from "bun:test";

const calls: unknown[][] = [];
const record = { key: "hidden", userKey: "user", source: "document" as const, sourceKey: "hidden", createdAt: "2026-08-18T00:00:00.000Z" };

mock.module("@/lib/api-client", () => ({ apiClient: {
  get: async (...args: unknown[]) => { calls.push(["get", ...args]); return { data: [record] }; },
  post: async (...args: unknown[]) => { calls.push(["post", ...args]); return { data: record }; },
  delete: async (...args: unknown[]) => { calls.push(["delete", ...args]); return { data: record }; },
} }));

const { filterByHiddenView, hiddenSourceFor, hideUserSource, listUserHiddens, revealUserSource } = await import("./user-hidden-client");

beforeEach(() => calls.splice(0));

test("uses the authenticated per-user hidden overlay contract", async () => {
  expect(await listUserHiddens()).toEqual([record]);
  await hideUserSource("document", "document");
  await revealUserSource("document", "document");
  expect(calls).toEqual([
    ["get", "/auth/me/hiddens"],
    ["post", "/auth/me/hiddens", { source: "document", sourceKey: "document" }],
    ["delete", "/auth/me/hiddens", { params: { source: "document", sourceKey: "document" } }],
  ]);
});

test("maps files to documents and applies favorite and hidden filters independently", () => {
  expect(hiddenSourceFor("file")).toBe("document");
  const items = [{ key: "visible", isFavorite: true }, { key: "hidden", isFavorite: true }, { key: "plain", isFavorite: false }];
  expect(filterByHiddenView(items, [record], "file", { favoritesOnly: false, showHidden: false }).map(({ key }) => key)).toEqual(["visible", "plain"]);
  expect(filterByHiddenView(items, [record], "file", { favoritesOnly: true, showHidden: false }).map(({ key }) => key)).toEqual(["visible"]);
  expect(filterByHiddenView(items, [record], "file", { favoritesOnly: false, showHidden: true }).map(({ key }) => key)).toEqual(["visible", "hidden", "plain"]);
  expect(filterByHiddenView(items, [record], "file", { favoritesOnly: true, showHidden: true }).map(({ key }) => key)).toEqual(["visible", "hidden"]);
});
