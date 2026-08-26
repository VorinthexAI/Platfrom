import { expect, test } from "bun:test";

import { BookProgressWriter, mergeBookProgressIntent } from "./book-progress";

test("coalesces serialized progress and never rolls completion back", async () => {
  let release!: () => void;
  const firstWrite = new Promise<void>((resolve) => { release = resolve; });
  const writes: { progressSeconds: number; isCompleted: boolean }[] = [];
  const writer = new BookProgressWriter();
  const write = async (intent: { progressSeconds: number; isCompleted: boolean }) => {
    writes.push(intent);
    if (writes.length === 1) await firstWrite;
  };
  const first = writer.enqueue("chapter", { progressSeconds: 10, isCompleted: false }, write);
  const second = writer.enqueue("chapter", { progressSeconds: 30, isCompleted: true }, write);
  writer.enqueue("chapter", { progressSeconds: 20, isCompleted: false }, write);
  expect(writes).toEqual([{ progressSeconds: 10, isCompleted: false }]);
  release();
  await Promise.all([first, second]);
  expect(writes).toEqual([{ progressSeconds: 10, isCompleted: false }, { progressSeconds: 30, isCompleted: true }]);
  expect(mergeBookProgressIntent({ progressSeconds: 50, isCompleted: true }, { progressSeconds: 5, isCompleted: false })).toEqual({ progressSeconds: 50, isCompleted: true });
});

test("keeps acknowledged intent monotonic across sequential drains", async () => {
  const writes: { progressSeconds: number; isCompleted: boolean }[] = [];
  const writer = new BookProgressWriter();
  const write = async (intent: { progressSeconds: number; isCompleted: boolean }) => { writes.push(intent); };
  await writer.enqueue("chapter", { progressSeconds: 90, isCompleted: true }, write);
  await writer.enqueue("chapter", { progressSeconds: 15, isCompleted: false }, write);
  expect(writes).toEqual([
    { progressSeconds: 90, isCompleted: true },
    { progressSeconds: 90, isCompleted: true },
  ]);
});

test("retains failed desired progress for a later retry", async () => {
  const writer = new BookProgressWriter();
  await expect(writer.enqueue("chapter", { progressSeconds: 45, isCompleted: true }, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  const writes: { progressSeconds: number; isCompleted: boolean }[] = [];
  await writer.enqueue("chapter", { progressSeconds: 10, isCompleted: false }, async (intent) => { writes.push(intent); });
  expect(writes).toEqual([{ progressSeconds: 45, isCompleted: true }]);
});

test("reset clears desired and acknowledged progress", async () => {
  const writer = new BookProgressWriter();
  await writer.enqueue("identity:chapter", { progressSeconds: 90, isCompleted: true }, async () => undefined);
  writer.reset();
  const writes: { progressSeconds: number; isCompleted: boolean }[] = [];
  await writer.enqueue("identity:chapter", { progressSeconds: 5, isCompleted: false }, async (intent) => { writes.push(intent); });
  expect(writes).toEqual([{ progressSeconds: 5, isCompleted: false }]);
});

test("an in-flight drain cannot clear or advance a post-reset drain", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const writer = new BookProgressWriter();
  const first = writer.enqueue("identity:chapter", { progressSeconds: 80, isCompleted: true }, async () => blocked);
  writer.reset();
  const writes: { progressSeconds: number; isCompleted: boolean }[] = [];
  await writer.enqueue("identity:chapter", { progressSeconds: 7, isCompleted: false }, async (intent) => { writes.push(intent); });
  release();
  await first;
  await writer.enqueue("identity:chapter", { progressSeconds: 9, isCompleted: false }, async (intent) => { writes.push(intent); });
  expect(writes).toEqual([
    { progressSeconds: 7, isCompleted: false },
    { progressSeconds: 9, isCompleted: false },
  ]);
});
