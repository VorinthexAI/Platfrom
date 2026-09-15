import { beforeEach, expect, mock, test } from "bun:test";

const records = new Map<string, string>();
let unavailable = false;
mock.module("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
  getItemAsync: async (key: string) => { if (unavailable) throw new Error("storage unavailable"); return records.get(key) ?? null; },
  setItemAsync: async (key: string, value: string) => { records.set(key, value); },
  deleteItemAsync: async (key: string) => { if (unavailable) throw new Error("storage unavailable"); records.delete(key); },
}));
const { readConversationSelection, writeConversationSelection } = await import("./conversation-selection-vault");
const context = { userKey: "user", teamKey: "team", scopeKey: "scope" };
const selected = { key: "manually-opened-chat", name: "Selected chat", isFavorite: false, createdAt: "2026-09-15T12:00:00.000Z", updatedAt: "2026-09-15T13:00:00.000Z" };

beforeEach(() => { records.clear(); unavailable = false; });

test("a cold cache has no conversation to restore", async () => {
  expect(await readConversationSelection(context)).toBeUndefined();
});

test("restores the explicitly remembered chat across close/reopen and isolates identities", async () => {
  await writeConversationSelection(context, selected);
  expect(await readConversationSelection(context)).toEqual(selected);
  expect(await readConversationSelection({ ...context, userKey: "other" })).toBeUndefined();
  expect(await readConversationSelection({ ...context, scopeKey: "other" })).toBeUndefined();
  expect(await readConversationSelection({ ...context, teamKey: "other" })).toBeUndefined();
});

test("New chat or deletion clears the selection instead of finding another chat", async () => {
  await writeConversationSelection(context, selected);
  await writeConversationSelection(context, undefined);
  expect(await readConversationSelection(context)).toBeUndefined();
});

test("corrupt and unavailable storage fall back to greeting without blocking opening", async () => {
  await writeConversationSelection(context, selected);
  for (const key of records.keys()) records.set(key, "corrupt");
  expect(await readConversationSelection(context)).toBeUndefined();
  expect(records.size).toBe(0);
  unavailable = true;
  expect(await readConversationSelection(context)).toBeUndefined();
});
