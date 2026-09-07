import { beforeEach, expect, mock, test } from "bun:test";

const calls: { path: string; body: unknown }[] = [];
let data: unknown;
mock.module("./api-client", () => ({ apiClient: { post: async (path: string, body: unknown) => { calls.push({ path, body }); return { data }; } } }));
const client = await import("./team-client");

const option = { key: "team-a", name: "Team A", slug: "team-a", role: "owner", teamMembershipKey: "membership-a", mfaEnabled: true, currentScopeKey: "scope-a", defaultScopeKey: "scope-a", scopes: [{ key: "scope-a", name: "Main", slug: "main", isCurrent: true, isDefault: true }] };

beforeEach(() => { calls.length = 0; data = { success: true, data: { teams: [option] } }; });

test("uses strict team list and selection contracts", async () => {
  await expect(client.listTeams()).resolves.toEqual([option]);
  data = { success: true, data: { status: "setup_required", challengeToken: "a".repeat(64), teamKey: "team-a", scopeKey: "scope-a", expiresAt: "2026-09-06T12:00:00.000Z" } };
  await expect(client.selectTeam("team-a", "scope-a")).resolves.toMatchObject({ status: "setup_required", teamKey: "team-a" });
  expect(calls).toEqual([{ path: "/teams/list", body: {} }, { path: "/teams/select", body: { targetTeamKey: "team-a", targetScopeKey: "scope-a" } }]);
  data = { success: true, data: { teams: [{ ...option, extra: true }] } };
  await expect(client.listTeams()).rejects.toThrow();
});

test("matches both old team and old scope query keys for eviction", () => {
  expect(client.queryBelongsToTeamScope(["gallery", "team-a", "scope-a"], "team-a", "scope-a")).toBe(true);
  expect(client.queryBelongsToTeamScope(["team-list", "user"], "team-a", "scope-a")).toBe(false);
});
