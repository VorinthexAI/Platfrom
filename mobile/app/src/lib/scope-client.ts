import { z } from "zod";

import { apiClient } from "./api-client";
import { CanceledError } from "axios";
import { sessionEpoch, sessionIsCurrent } from "./session-lifecycle";

export const scopeSummarySchema = z.strictObject({
  key: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().nullable(),
  coverFileKey: z.string().nullable().optional(),
  position: z.number().int().positive(),
  isCurrent: z.boolean(),
});

const listEnvelopeSchema = z.strictObject({ success: z.literal(true), data: z.strictObject({ scopes: z.array(scopeSummarySchema) }) });
const scopeEnvelopeSchema = z.strictObject({ success: z.literal(true), data: z.strictObject({ scope: scopeSummarySchema }) });
const deleteEnvelopeSchema = z.strictObject({ success: z.literal(true), data: z.strictObject({ deleted: z.literal(true) }) });

export type ScopeSummary = z.infer<typeof scopeSummarySchema>;
export const scopeListQueryKey = (userKey: string) => ["scope-list", userKey] as const;

let scopeOperationSequence = 0;
let scopeOperationQueue = Promise.resolve();
let pendingScopeOperations = 0;

export function scheduleScopeOperation<T>(run: () => Promise<T>) {
  const owner = sessionEpoch();
  const sequence = ++scopeOperationSequence;
  pendingScopeOperations += 1;
  const promise = scopeOperationQueue.catch(() => undefined).then(() => {
    if (!sessionIsCurrent(owner)) throw new CanceledError("canceled");
    return run();
  });
  scopeOperationQueue = promise.then(() => undefined, () => undefined).finally(() => { pendingScopeOperations -= 1; });
  return { isCurrent: () => sequence === scopeOperationSequence && sessionIsCurrent(owner), promise };
}

export function scopeOperationIsPending() {
  return pendingScopeOperations > 0;
}

export async function listScopes(signal?: AbortSignal) {
  const response = await apiClient.post("/scopes/list", {}, { signal });
  return listEnvelopeSchema.parse(response.data).data.scopes;
}

export async function createScope(input: { name: string; description?: string }, idempotencyKey: string) {
  const response = await apiClient.post("/scopes", input, { headers: { "Idempotency-Key": idempotencyKey } });
  return scopeEnvelopeSchema.parse(response.data).data.scope;
}

export async function selectScope(targetScopeKey: string) {
  const response = await apiClient.post("/scopes/select", { targetScopeKey });
  return scopeEnvelopeSchema.parse(response.data).data.scope;
}

export async function deleteScope(scopeKey: string) {
  const response = await apiClient.delete(`/scopes/${encodeURIComponent(scopeKey)}`);
  return deleteEnvelopeSchema.parse(response.data).data;
}
