import { z } from "zod";
import { randomUUID } from "expo-crypto";

import { apiClient } from "@/lib/api-client";
import type { ContentContext } from "@/lib/content-client";

export const scopeTagSchema = z.strictObject({
  key: z.string().cuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ScopeTag = z.infer<typeof scopeTagSchema>;

export const resourceTagTargetSchema = z.strictObject({
  type: z.enum(["folder", "file"]),
  key: z.string().cuid(),
});
export type ResourceTagTarget = z.infer<typeof resourceTagTargetSchema>;

const createRequestSchema = z.strictObject({ scopeKey: z.string().cuid(), key: z.string().cuid(), name: z.string().trim().min(1).max(120) });
const failureSchema = z.strictObject({ success: z.literal(false), error: z.strictObject({ code: z.string().min(1), message: z.string().min(1) }) });

function responseError(error: unknown) {
  const parsed = failureSchema.safeParse((error as { response?: { data?: unknown } }).response?.data);
  if (parsed.success) return new Error(parsed.data.error.message);
  const failure = (error as { response?: { data?: { error?: unknown } } }).response?.data?.error;
  if (typeof failure === "string") return new Error(failure);
  if (failure && typeof failure === "object" && "message" in failure && typeof failure.message === "string") return new Error(failure.message);
  return error;
}

export function createResourceTagKey() {
  return `c${randomUUID().replace(/-/g, "")}`;
}

export async function createScopeTag(context: ContentContext, input: { key: string; name: string }) {
  const payload = createRequestSchema.parse({ scopeKey: context.scopeKey, ...input });
  try {
    const response = await apiClient.post("/content/tools/tag.create", { scopeKey: context.scopeKey, input: payload }, { timeout: 15_000 });
    const envelope = z.discriminatedUnion("success", [z.strictObject({ success: z.literal(true), data: z.strictObject({ tag: scopeTagSchema }) }), failureSchema]).parse(response.data);
    if (!envelope.success) throw new Error(envelope.error.message);
    return envelope.data.tag;
  } catch (error) {
    throw responseError(error);
  }
}

export async function listScopeTags(context: ContentContext, signal?: AbortSignal) {
  try {
    const response = await apiClient.post("/content/tools/tag.list", { scopeKey: context.scopeKey, input: { scopeKey: context.scopeKey } }, { signal, timeout: 15_000 });
    const envelope = z.discriminatedUnion("success", [z.strictObject({ success: z.literal(true), data: z.strictObject({ items: z.array(scopeTagSchema) }) }), failureSchema]).parse(response.data);
    if (!envelope.success) throw new Error("Tags could not be loaded.");
    return envelope.data.items;
  } catch (error) {
    throw responseError(error);
  }
}

export function resourceTagTargetIdentity(target: ResourceTagTarget) {
  return `${target.type}:${target.key}`;
}

export function normalizeResourceTagTargets(targets: readonly ResourceTagTarget[]) {
  const parsed = targets.map((target) => resourceTagTargetSchema.parse(target));
  return [...new Map(parsed.map((target) => [resourceTagTargetIdentity(target), target])).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, target]) => target);
}

export type ResourceTagAssignmentState = { tags: ScopeTag[]; tagKeysByTarget: Record<string, string[]> };

export function appendResourceTag(state: ResourceTagAssignmentState, tag: ScopeTag): ResourceTagAssignmentState {
  return { ...state, tags: [...state.tags.filter(({ key }) => key !== tag.key), tag] };
}

export function replaceResourceTag(state: ResourceTagAssignmentState, tag: ScopeTag): ResourceTagAssignmentState {
  return appendResourceTag(state, tag);
}

export function removeResourceTag(state: ResourceTagAssignmentState, tagKey: string): ResourceTagAssignmentState {
  return { tags: state.tags.filter(({ key }) => key !== tagKey), tagKeysByTarget: Object.fromEntries(Object.entries(state.tagKeysByTarget).map(([identity, tagKeys]) => [identity, tagKeys.filter((key) => key !== tagKey)])) };
}

export async function listResourceTagAssignments(context: ContentContext, targets: readonly ResourceTagTarget[], signal?: AbortSignal): Promise<ResourceTagAssignmentState> {
  try {
    const normalizedTargets = normalizeResourceTagTargets(targets);
    const [tags, response] = await Promise.all([
      listScopeTags(context, signal),
      apiClient.post("/content/tools/tag.assignment.list", { scopeKey: context.scopeKey, input: { scopeKey: context.scopeKey, targets: normalizedTargets } }, { signal, timeout: 15_000 }),
    ]);
    const envelope = z.discriminatedUnion("success", [
      z.strictObject({ success: z.literal(true), data: z.strictObject({ items: z.array(z.strictObject({ target: resourceTagTargetSchema, tagKeys: z.array(z.string().cuid()) })) }) }),
      failureSchema,
    ]).parse(response.data);
    if (!envelope.success) throw new Error(envelope.error.message);
    const assignments = Object.fromEntries(normalizedTargets.map((target) => [resourceTagTargetIdentity(target), [] as string[]]));
    for (const assignment of envelope.data.items) assignments[resourceTagTargetIdentity(assignment.target)] = assignment.tagKeys;
    return { tags, tagKeysByTarget: assignments };
  } catch (error) {
    throw responseError(error);
  }
}

export type ResourceTagAssignmentAction = "tag" | "untag";
export type ResourceTagAssignmentRequest = { action: ResourceTagAssignmentAction; targets: ResourceTagTarget[]; tagKeys: string[] };

export async function resolvePendingResourceTagDraft(draft: Readonly<Record<string, ResourceTagAssignmentAction>>, pending: ReadonlyMap<string, Promise<boolean>>) {
  const results = await Promise.all(Object.keys(draft).flatMap((key) => {
    const promise = pending.get(key);
    return promise ? [promise.then((succeeded) => [key, succeeded] as const)] : [];
  }));
  const failedKeys = results.filter(([, succeeded]) => !succeeded).map(([key]) => key);
  const resolvedDraft = { ...draft };
  for (const key of failedKeys) delete resolvedDraft[key];
  return { draft: resolvedDraft, failedKeys };
}

export function groupResourceTagAssignmentRequests(targets: readonly ResourceTagTarget[], operations: Readonly<Record<string, ResourceTagAssignmentAction>>): ResourceTagAssignmentRequest[] {
  const normalizedTargets = normalizeResourceTagTargets(targets);
  return (["tag", "untag"] as const).flatMap((action) => {
    const tagKeys = Object.entries(operations).filter(([, candidate]) => candidate === action).map(([tagKey]) => z.string().cuid().parse(tagKey)).sort();
    if (!tagKeys.length) return [];
    const tagsPerRequest = Math.min(tagKeys.length, 100);
    const requests: ResourceTagAssignmentRequest[] = [];
    for (let tagIndex = 0; tagIndex < tagKeys.length; tagIndex += tagsPerRequest) {
      const tagChunk = tagKeys.slice(tagIndex, tagIndex + tagsPerRequest);
      const targetsPerRequest = Math.max(1, Math.floor(100 / tagChunk.length));
      for (let targetIndex = 0; targetIndex < normalizedTargets.length; targetIndex += targetsPerRequest) requests.push({ action, targets: normalizedTargets.slice(targetIndex, targetIndex + targetsPerRequest), tagKeys: tagChunk });
    }
    return requests;
  });
}

export async function persistResourceTagAssignments(context: ContentContext, requests: readonly ResourceTagAssignmentRequest[]) {
  try {
    const results = await Promise.allSettled(requests.map(({ action, targets, tagKeys }) => apiClient.post("/content/tools/tag.assignment.set", { scopeKey: context.scopeKey, input: { scopeKey: context.scopeKey, targets, tagKeys, assigned: action === "tag" } }, { timeout: 15_000 })));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw failure.reason;
  } catch (error) {
    throw responseError(error);
  }
}

export function tagFilterContextKey(context: Pick<ContentContext, "userKey" | "scopeKey">) {
  return `${context.userKey}:${context.scopeKey}`;
}
