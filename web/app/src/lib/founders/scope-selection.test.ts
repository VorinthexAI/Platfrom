import { describe, expect, test } from "bun:test";
import { selectDefaultScope } from "./scope-selection";
import type { AccessibleScopeOption } from "./types";

const scopes: AccessibleScopeOption[] = [
  { key: "nexus", name: "Nexus", position: 1, parentKey: null, path: ["Nexus"] },
  { key: "core", name: "Core", position: 2, parentKey: "nexus", path: ["Nexus", "Core"] },
  { key: "launch", name: "Launch", position: 3, parentKey: "nexus", path: ["Nexus", "Launch"] },
];

describe("selectDefaultScope", () => {
  test("prefers the stored scope when it is still accessible", () => {
    expect(selectDefaultScope(scopes, "launch")).toBe("launch");
  });

  test("ignores a stored scope that is no longer accessible", () => {
    expect(selectDefaultScope(scopes, "gone")).toBe("nexus");
  });

  test("falls back to the accessible root scope", () => {
    expect(selectDefaultScope(scopes, null)).toBe("nexus");
  });

  test("falls back to the first accessible scope when no root is accessible", () => {
    expect(selectDefaultScope(scopes.slice(1), null)).toBe("core");
  });

  test("returns null when no scopes are accessible", () => {
    expect(selectDefaultScope([], "core")).toBeNull();
  });
});
