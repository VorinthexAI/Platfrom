import type { QueryClient } from "@tanstack/react-query";

import type { ContentContext } from "@/lib/content-client";
import { listResourceTagAssignments, listScopeTags, normalizeResourceTagTargets, resourceTagTargetIdentity, tagFilterContextKey, type ResourceTagAssignmentAction, type ResourceTagAssignmentState, type ResourceTagTarget } from "@/lib/tag-client";

export const scopeTagsQueryRoot = ["scope-tags"] as const;
export const scopeTagsQueryKey = (context: ContentContext) => [...scopeTagsQueryRoot, tagFilterContextKey(context)] as const;

export async function refreshScopeTags(queryClient: QueryClient, context: ContentContext) {
  const queryKey = scopeTagsQueryKey(context);
  await queryClient.cancelQueries({ queryKey, exact: true });
  await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
  return queryClient.fetchQuery({ queryKey, queryFn: ({ signal }) => listScopeTags(context, signal), staleTime: 0 });
}

export const resourceTagAssignmentsQueryRoot = ["resource-tag-assignments"] as const;
export const resourceTagAssignmentsQueryKey = (context: ContentContext, targets: readonly ResourceTagTarget[]) => [
  ...resourceTagAssignmentsQueryRoot,
  context.userKey,
  context.organizationKey,
  context.scopeKey,
  normalizeResourceTagTargets(targets).map(resourceTagTargetIdentity),
] as const;

export async function refreshResourceTagAssignments(queryClient: QueryClient, context: ContentContext, targets: readonly ResourceTagTarget[]) {
  const normalizedTargets = normalizeResourceTagTargets(targets);
  const queryKey = resourceTagAssignmentsQueryKey(context, normalizedTargets);
  await queryClient.cancelQueries({ queryKey, exact: true });
  await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
  return queryClient.fetchQuery({ queryKey, queryFn: ({ signal }) => listResourceTagAssignments(context, normalizedTargets, signal), staleTime: 0 });
}

export type ResourceTagTriState = "all" | "some" | "none";
export type ResourceTagDraft = Record<string, ResourceTagAssignmentAction>;

export function resourceTagState(state: ResourceTagAssignmentState, targets: readonly ResourceTagTarget[], tagKey: string, draft: ResourceTagDraft = {}): ResourceTagTriState {
  const operation = draft[tagKey];
  if (operation) return operation === "tag" ? "all" : "none";
  const assigned = normalizeResourceTagTargets(targets).filter((target) => state.tagKeysByTarget[resourceTagTargetIdentity(target)]?.includes(tagKey)).length;
  return assigned === 0 ? "none" : assigned === normalizeResourceTagTargets(targets).length ? "all" : "some";
}

export function toggleResourceTagDraft(draft: ResourceTagDraft, state: ResourceTagAssignmentState, targets: readonly ResourceTagTarget[], tagKey: string): ResourceTagDraft {
  return { ...draft, [tagKey]: resourceTagState(state, targets, tagKey, draft) === "all" ? "untag" : "tag" };
}

export function applyResourceTagDraft(state: ResourceTagAssignmentState, targets: readonly ResourceTagTarget[], draft: ResourceTagDraft): ResourceTagAssignmentState {
  const tagKeysByTarget = { ...state.tagKeysByTarget };
  for (const target of normalizeResourceTagTargets(targets)) {
    const identity = resourceTagTargetIdentity(target);
    const keys = new Set(tagKeysByTarget[identity] ?? []);
    for (const [tagKey, action] of Object.entries(draft)) action === "tag" ? keys.add(tagKey) : keys.delete(tagKey);
    tagKeysByTarget[identity] = [...keys].sort();
  }
  return { ...state, tagKeysByTarget };
}
