import { describe, expect, test } from "bun:test";
import { parseOrganizationInvalidation } from "./organization-events";

describe("organization invalidation stream", () => {
  test("accepts the thin invalidation envelope", () => {
    expect(parseOrganizationInvalidation(JSON.stringify({
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
    expect(parseOrganizationInvalidation('{"slug":"scope.list","scopeKey":"scope-1","resource":null}')).toEqual({
      slug: "scope.list",
      scopeKey: "scope-1",
      resource: null,
    });
  });

  test("rejects malformed messages and never exposes extra payload fields", () => {
    expect(parseOrganizationInvalidation("not-json")).toBeNull();
    expect(parseOrganizationInvalidation('{"slug":"artifact.updated","scopeKey":"scope-1","resource":{"type":"artifacts"}}')).toBeNull();
    expect(parseOrganizationInvalidation(JSON.stringify({
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
