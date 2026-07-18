import { describe, expect, test } from "bun:test";
import { parseNexusInvalidation } from "./nexus-events";

describe("Nexus invalidation stream", () => {
  test("accepts the thin invalidation envelope", () => {
    expect(parseNexusInvalidation(JSON.stringify({
      slug: "artifact.updated",
      scopeKey: "scope-1",
      resource: { type: "artifacts", key: "artifact-1" },
    }))).toEqual({
      slug: "artifact.updated",
      scopeKey: "scope-1",
      resource: { type: "artifacts", key: "artifact-1" },
    });
  });

  test("accepts collection-level invalidations", () => {
    expect(parseNexusInvalidation('{"slug":"scope.list","scopeKey":"scope-1","resource":null}')).toEqual({
      slug: "scope.list",
      scopeKey: "scope-1",
      resource: null,
    });
  });

  test("rejects malformed messages and never exposes extra payload fields", () => {
    expect(parseNexusInvalidation("not-json")).toBeNull();
    expect(parseNexusInvalidation('{"slug":"artifact.updated","scopeKey":"scope-1","resource":{"type":"artifacts"}}')).toBeNull();
    expect(parseNexusInvalidation(JSON.stringify({
      slug: "tool.failed",
      scopeKey: "scope-1",
      resource: { type: "agentRuns", key: "run-1" },
      data: { reason: "private" },
    }))).toEqual({
      slug: "tool.failed",
      scopeKey: "scope-1",
      resource: { type: "agentRuns", key: "run-1" },
    });
  });
});
