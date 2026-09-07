import { expect, test } from "bun:test";

import { scheduleScopeOperation, scopeListQueryKey, scopeSummarySchema } from "./scope-client";

test("scope summaries are strict, safe projections and keys are team-aware", () => {
  const scope = { key: "scope", slug: "main", name: "Main", summary: "Main workspace", description: null, position: 1, level: 1, role: "owner", isCurrent: true };
  expect(scopeSummarySchema.parse(scope)).toEqual(scope);
  expect(scopeSummarySchema.safeParse({ ...scope, embedding: [1, 2] }).success).toBe(false);
  expect(scopeListQueryKey("user", "team")).toEqual(["scope-list", "user", "team"]);
});

test("scope mutations are serialized and only the latest remains current", async () => {
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = scheduleScopeOperation(async () => { order.push("first:start"); await gate; order.push("first:end"); return "first"; });
  const second = scheduleScopeOperation(async () => { order.push("second"); return "second"; });

  await Promise.resolve();
  await Promise.resolve();
  expect(order).toEqual(["first:start"]);
  release();
  expect(await first.promise).toBe("first");
  expect(await second.promise).toBe("second");
  expect(order).toEqual(["first:start", "first:end", "second"]);
  expect(first.isCurrent()).toBe(false);
  expect(second.isCurrent()).toBe(true);
});
