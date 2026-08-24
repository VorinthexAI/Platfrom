import { expect, test } from "bun:test";

import { loadEmailTrashGroups } from "./email-trash-aggregation";

const connector = (key: string) => ({ connectorKey: key, name: key }) as never;
const thread = (key: string) => ({ key }) as never;

test("retains successful inbox Trash results and the actual error when another inbox fails", async () => {
  const result = await loadEmailTrashGroups([connector("one"), connector("two")], async (connectorKey) => {
    if (connectorKey === "two") throw new Error("Reconnect Gmail with permanent-delete scope");
    return { threads: [thread("thread-one")], nextCursor: null };
  }, () => true, (error) => (error as Error).message);
  expect(result).toEqual([
    { connector: connector("one"), threads: [thread("thread-one")] },
    { connector: connector("two"), threads: [], error: "Reconnect Gmail with permanent-delete scope" },
  ]);
});

test("contains repeated cursors and page-limit overflow to the affected inbox", async () => {
  const repeated = await loadEmailTrashGroups([connector("cycle")], async () => ({ threads: [], nextCursor: "same" }), () => true, (error) => (error as Error).message);
  expect(repeated?.[0]?.error).toBe("Trash pagination repeated a cursor.");
  let page = 0;
  const bounded = await loadEmailTrashGroups([connector("bounded")], async () => ({ threads: [], nextCursor: `page-${++page}` }), () => true, (error) => (error as Error).message, 2);
  expect(bounded?.[0]?.error).toBe("Trash pagination exceeded the safe page limit.");
});

test("stops without committing groups when ownership changes during a page", async () => {
  let current = true;
  expect(await loadEmailTrashGroups([connector("one")], async () => { current = false; return { threads: [thread("late")], nextCursor: null }; }, () => current, (error) => String(error))).toBeUndefined();
});
