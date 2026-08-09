import { expect, test } from "bun:test";
import { isContentContextConfigured } from "./content-client";

test("requires every content context value", () => {
  expect(isContentContextConfigured({ organizationKey: "org", agentKey: "agent", scopeKey: "scope" })).toBe(true);
  expect(isContentContextConfigured({ organizationKey: "org", agentKey: "", scopeKey: "scope" })).toBe(false);
  expect(isContentContextConfigured({ organizationKey: "org", agentKey: "   ", scopeKey: "scope" })).toBe(false);
});
