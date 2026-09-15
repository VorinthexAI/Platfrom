import { z } from "zod";

import { apiClient } from "./api-client";

const keySchema = z.string().trim().min(1).max(160);
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
const selectEnvelopeSchema = z.strictObject({ success: z.literal(true), data: z.union([selectedSchema, challengedSchema]) });

export type TeamSelection = z.infer<typeof selectEnvelopeSchema>["data"];

export async function selectTeam(targetTeamKey: string, targetScopeKey?: string) {
  const response = await apiClient.post("/teams/select", { targetTeamKey, ...(targetScopeKey ? { targetScopeKey } : {}) });
  return selectEnvelopeSchema.parse(response.data).data;
}

export function queryBelongsToTeamScope(queryKey: readonly unknown[], teamKey: string, scopeKey: string) {
  return queryKey.some((part) => part === teamKey || part === scopeKey);
}

type PendingTeamMfa = { status: "setup_required" | "totp_required"; challengeToken: string; teamKey?: string; scopeKey?: string; expiresAt?: string };
let pendingTeamMfa: PendingTeamMfa | null = null;
export function setPendingTeamMfaChallenge(status: PendingTeamMfa["status"], challengeToken: string) { pendingTeamMfa = { status, challengeToken }; }
export function takePendingTeamMfa() { const value = pendingTeamMfa; pendingTeamMfa = null; return value; }
