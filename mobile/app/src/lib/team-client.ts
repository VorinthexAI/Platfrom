import { z } from "zod";

import { apiClient } from "./api-client";

const keySchema = z.string().trim().min(1).max(160);
const scopeSchema = z.strictObject({
  key: keySchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  isCurrent: z.boolean(),
  isDefault: z.boolean(),
});
export const teamOptionSchema = z.strictObject({
  key: keySchema,
  name: z.string().min(1),
  slug: z.string().nullable(),
  role: z.string().min(1),
  teamMembershipKey: keySchema,
  mfaEnabled: z.boolean(),
  currentScopeKey: keySchema.nullable(),
  defaultScopeKey: keySchema.nullable(),
  scopes: z.array(scopeSchema),
});
const selectedSchema = z.strictObject({
  status: z.literal("selected"),
  team: z.strictObject({ key: keySchema, name: z.string().min(1), slug: z.string().nullable(), role: z.string().min(1), mfaEnabled: z.boolean() }),
  scope: z.strictObject({ key: keySchema, name: z.string().min(1), slug: z.string().min(1) }),
});
const challengedSchema = z.strictObject({
  status: z.enum(["setup_required", "totp_required"]),
  challengeToken: z.string().regex(/^[a-f0-9]{64}$/),
  teamKey: keySchema,
  scopeKey: keySchema,
  expiresAt: z.string().datetime(),
});
const listEnvelopeSchema = z.strictObject({ success: z.literal(true), data: z.strictObject({ teams: z.array(teamOptionSchema) }) });
const selectEnvelopeSchema = z.strictObject({ success: z.literal(true), data: z.union([selectedSchema, challengedSchema]) });

export type TeamOption = z.infer<typeof teamOptionSchema>;
export type TeamSelection = z.infer<typeof selectEnvelopeSchema>["data"];
export const teamListQueryKey = (userKey: string) => ["team-list", userKey] as const;

export async function listTeams(signal?: AbortSignal) {
  const response = await apiClient.post("/teams/list", {}, { signal });
  return listEnvelopeSchema.parse(response.data).data.teams;
}

export async function selectTeam(targetTeamKey: string, targetScopeKey?: string) {
  const response = await apiClient.post("/teams/select", { targetTeamKey, ...(targetScopeKey ? { targetScopeKey } : {}) });
  return selectEnvelopeSchema.parse(response.data).data;
}

export function queryBelongsToTeamScope(queryKey: readonly unknown[], teamKey: string, scopeKey: string) {
  return queryKey.some((part) => part === teamKey || part === scopeKey);
}

type PendingTeamMfa = { status: "setup_required" | "totp_required"; challengeToken: string; teamKey?: string; scopeKey?: string; expiresAt?: string };
let pendingTeamMfa: PendingTeamMfa | null = null;
export function setPendingTeamMfa(value: typeof pendingTeamMfa) { pendingTeamMfa = value; }
export function setPendingTeamMfaChallenge(status: PendingTeamMfa["status"], challengeToken: string) { pendingTeamMfa = { status, challengeToken }; }
export function takePendingTeamMfa() { const value = pendingTeamMfa; pendingTeamMfa = null; return value; }
