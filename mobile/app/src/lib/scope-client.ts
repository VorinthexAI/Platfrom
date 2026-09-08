import { z } from "zod";

import { apiClient } from "./api-client";

const richScopeProjection = { "X-Vorinthex-Scope-Projection": "2" };

export const scopeSummarySchema = z.strictObject({
  key: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().nullable(),
  coverImageKey: z.string().nullable(),
  coverUrl: z.string().nullable(),
  position: z.number().int().positive(),
  level: z.number().int().positive(),
  role: z.enum(["owner", "admin", "moderator", "viewer"]),
  isCurrent: z.boolean(),
});

const listEnvelopeSchema = z.strictObject({ success: z.literal(true), data: z.strictObject({ scopes: z.array(scopeSummarySchema) }) });
const scopeEnvelopeSchema = z.strictObject({ success: z.literal(true), data: scopeSummarySchema });
const deleteEnvelopeSchema = z.strictObject({ success: z.literal(true), data: z.strictObject({ deleted: z.literal(true), scopeKey: z.string().min(1) }) });

export type ScopeSummary = z.infer<typeof scopeSummarySchema>;
export const scopeListQueryKey = (userKey: string, teamKey: string) => ["scope-list", userKey, teamKey] as const;

let scopeOperationSequence = 0;
let scopeOperationQueue = Promise.resolve();
let pendingScopeOperations = 0;

export function scheduleScopeOperation<T>(run: () => Promise<T>) {
  const sequence = ++scopeOperationSequence;
  pendingScopeOperations += 1;
  const promise = scopeOperationQueue.catch(() => undefined).then(run);
  scopeOperationQueue = promise.then(() => undefined, () => undefined).finally(() => { pendingScopeOperations -= 1; });
  return { isCurrent: () => sequence === scopeOperationSequence, promise };
}

export function scopeOperationIsPending() {
  return pendingScopeOperations > 0;
}

export async function listScopes(teamKey: string, signal?: AbortSignal) {
  const response = await apiClient.post("/scopes/list", { teamKey }, { signal, headers: richScopeProjection });
  return listEnvelopeSchema.parse(response.data).data.scopes;
}

export async function createScope(teamKey: string, input: { name: string; description?: string }, idempotencyKey: string) {
  const response = await apiClient.post("/scopes", { teamKey, ...input }, { headers: { ...richScopeProjection, "Idempotency-Key": idempotencyKey } });
  return scopeEnvelopeSchema.parse(response.data).data;
}

export async function selectScope(teamKey: string, targetScopeKey: string) {
  const response = await apiClient.post("/scopes/select", { teamKey, targetScopeKey }, { headers: richScopeProjection });
  return scopeEnvelopeSchema.parse(response.data).data;
}

export async function prioritizeScope(teamKey: string, scopeKey: string) {
  const response = await apiClient.post(`/scopes/${encodeURIComponent(scopeKey)}/prioritize`, { teamKey }, { headers: richScopeProjection });
  return scopeEnvelopeSchema.parse(response.data).data;
}

export async function updateScopeCover(teamKey: string, scopeKey: string, coverImageKey: string | null) {
  const response = await apiClient.patch(`/scopes/${encodeURIComponent(scopeKey)}`, { teamKey, coverImageKey }, { headers: richScopeProjection });
  return scopeEnvelopeSchema.parse(response.data).data;
}

export async function deleteScope(teamKey: string, scopeKey: string) {
  const response = await apiClient.delete(`/scopes/${encodeURIComponent(scopeKey)}`, { data: { teamKey } });
  return deleteEnvelopeSchema.parse(response.data).data;
}
