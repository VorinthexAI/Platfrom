import { z } from "zod";

import { apiClient } from "./api-client";

export const scopeSummarySchema = z.strictObject({
  key: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().nullable(),
  position: z.number().int().positive(),
  level: z.number().int().positive(),
  role: z.enum(["owner", "admin", "moderator", "viewer"]),
  isCurrent: z.boolean(),
});

const listEnvelopeSchema = z.strictObject({ success: z.literal(true), data: z.strictObject({ scopes: z.array(scopeSummarySchema) }) });
const scopeEnvelopeSchema = z.strictObject({ success: z.literal(true), data: scopeSummarySchema });

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
  const response = await apiClient.post("/scopes/list", { teamKey }, { signal });
  return listEnvelopeSchema.parse(response.data).data.scopes;
}

export async function createScope(teamKey: string, input: { name: string; description?: string }, idempotencyKey: string) {
  const response = await apiClient.post("/scopes", { teamKey, ...input }, { headers: { "Idempotency-Key": idempotencyKey } });
  return scopeEnvelopeSchema.parse(response.data).data;
}

export async function selectScope(teamKey: string, targetScopeKey: string) {
  const response = await apiClient.post("/scopes/select", { teamKey, targetScopeKey });
  return scopeEnvelopeSchema.parse(response.data).data;
}
