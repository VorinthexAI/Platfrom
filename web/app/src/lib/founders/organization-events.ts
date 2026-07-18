export type OrganizationInvalidation = {
  slug: string;
  scopeKey: string;
  resource: { type: string; key: string } | null;
};

type Listener = (event: OrganizationInvalidation) => void;
type OrganizationChannel = { source: EventSource; listeners: Set<Listener> };

const channels = new Map<string, OrganizationChannel>();

export function parseOrganizationInvalidation(raw: string): OrganizationInvalidation | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.slug !== "string" || typeof candidate.scopeKey !== "string") return null;
    if (candidate.resource === null) return { slug: candidate.slug, scopeKey: candidate.scopeKey, resource: null };
    if (!candidate.resource || typeof candidate.resource !== "object" || Array.isArray(candidate.resource)) return null;
    const resource = candidate.resource as Record<string, unknown>;
    if (typeof resource.type !== "string" || typeof resource.key !== "string") return null;
    return { slug: candidate.slug, scopeKey: candidate.scopeKey, resource: { type: resource.type, key: resource.key } };
  } catch {
    return null;
  }
}

/** Shares one organization-wide SSE connection across all Nexus consumers. */
export function subscribeOrganizationInvalidations(organizationKey: string, listener: Listener): () => void {
  let channel = channels.get(organizationKey);
  if (!channel) {
    const source = new EventSource(`/api/founders/events/stream?${new URLSearchParams({ organizationKey })}`);
    channel = { source, listeners: new Set() };
    channels.set(organizationKey, channel);
    source.addEventListener("invalidate", ((message: MessageEvent<string>) => {
      const event = parseOrganizationInvalidation(message.data);
      if (!event) return;
      for (const subscriber of channels.get(organizationKey)?.listeners ?? []) subscriber(event);
    }) as EventListener);
  }

  channel.listeners.add(listener);
  return () => {
    const current = channels.get(organizationKey);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      current.source.close();
      channels.delete(organizationKey);
    }
  };
}
