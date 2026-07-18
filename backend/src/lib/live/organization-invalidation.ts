import { z } from 'zod';
import { registeredEventSlugs } from '@/platform/event-catalog';

const resourceSchema = z.object({
  type: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(160),
}).strict();

/**
 * The public organization stream is intentionally an invalidation protocol,
 * not a data transport. Consumers receive enough identity to invalidate a
 * cache entry and then re-read authorized state through the normal API.
 */
export const organizationInvalidationSchema = z.object({
  slug: z.string().trim().min(1).max(160),
  scopeKey: z.string().cuid(),
  resource: resourceSchema.nullable(),
}).strict();

export type OrganizationInvalidation = z.infer<typeof organizationInvalidationSchema>;

export interface PersistedOrganizationEvent {
  scopeId: string;
  slug: string;
  data?: Record<string, unknown> | null;
}

const subjectFields: ReadonlyArray<readonly [key: string, type: string]> = [
  ['artifactKey', 'artifacts'],
  ['agentKey', 'agents'],
  ['runKey', 'agentRuns'],
  ['scopeAgentKey', 'scopeAgents'],
  ['agentMemberKey', 'agentMembers'],
  ['scopeKey', 'scopes'],
  ['userOrganizationKey', 'userOrganizations'],
  ['providerKey', 'providers'],
  ['toolKey', 'tools'],
  ['actionKey', 'actions'],
  ['modelKey', 'models'],
];

const runtimePrefixes = ['agent.', 'step.', 'tool.', 'model.', 'artifact.', 'guardrail.'] as const;
const mutationSuffixes = [
  '.create', '.update', '.add', '.move', '.archive', '.restore', '.remove',
  '.grant', '.revoke', '.sync', '.enable', '.disable', '.activate', '.suspend',
] as const;

export function isOrganizationInvalidationSlug(slug: string): boolean {
  return runtimePrefixes.some((prefix) => slug.startsWith(prefix))
    || mutationSuffixes.some((suffix) => slug.endsWith(suffix));
}

/** Excludes analytics/read events before the database returns them to SSE. */
export const organizationInvalidationSlugs = registeredEventSlugs.filter(isOrganizationInvalidationSlug);

/** Projects a persisted event without ever forwarding its domain payload. */
export function projectOrganizationInvalidation(event: PersistedOrganizationEvent): OrganizationInvalidation {
  const data = event.data ?? {};
  const nodeType = typeof data.nodeType === 'string' ? data.nodeType : null;
  const nodeKey = typeof data.nodeKey === 'string' ? data.nodeKey : null;
  if (nodeType && nodeKey) {
    return organizationInvalidationSchema.parse({
      slug: event.slug,
      scopeKey: event.scopeId,
      resource: { type: nodeType, key: nodeKey },
    });
  }

  for (const [field, type] of subjectFields) {
    const key = data[field];
    if (typeof key === 'string' && key.length > 0) {
      return organizationInvalidationSchema.parse({
        slug: event.slug,
        scopeKey: event.scopeId,
        resource: { type, key },
      });
    }
  }

  return organizationInvalidationSchema.parse({ slug: event.slug, scopeKey: event.scopeId, resource: null });
}

export function artifactInvalidation(scopeKey: string, artifactKey: string): OrganizationInvalidation {
  return organizationInvalidationSchema.parse({
    slug: 'artifact.invalidated',
    scopeKey,
    resource: { type: 'artifacts', key: artifactKey },
  });
}
