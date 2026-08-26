export const APP_EVENT_SLUGS = [
  'collection.index.changed',
  'collection.content.changed',
  'collection.access.changed',
  'collection.invites.changed',
  'collection.shares.changed',
  'image.changed',
  'upload.changed',
  'subject.changed',
  'highlight.changed',
  'memory.created',
  'memory.deleted',
  'trip.changed',
  'place.reference.changed',
  'content.changed',
  'inbox.changed',
  'book.changed',
] as const;
export type AppEventSlug = (typeof APP_EVENT_SLUGS)[number];
export type EventEnvelope =
  | { route: 'user'; userKey: string; event: AppEventSlug }
  | { route: 'collection'; collectionKey: string; event: AppEventSlug }
  | { route: 'scope'; scopeKey: string; event: AppEventSlug };

const eventSlugs = new Set<string>(APP_EVENT_SLUGS);

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && keys.sort().every((key, index) => actual[index] === key);
}

export function parseEventEnvelope(message: string): EventEnvelope | null {
  try {
    const value: unknown = JSON.parse(message);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const envelope = value as Record<string, unknown>;
    if (typeof envelope.event !== 'string' || !eventSlugs.has(envelope.event)) return null;
    if (envelope.route === 'user'
      && hasExactKeys(envelope, ['route', 'userKey', 'event'])
      && typeof envelope.userKey === 'string' && envelope.userKey.length > 0) {
      return envelope as EventEnvelope;
    }
    if (envelope.route === 'collection'
      && hasExactKeys(envelope, ['route', 'collectionKey', 'event'])
      && typeof envelope.collectionKey === 'string' && envelope.collectionKey.length > 0) {
      return envelope as EventEnvelope;
    }
    if (envelope.route === 'scope'
      && hasExactKeys(envelope, ['route', 'scopeKey', 'event'])
      && typeof envelope.scopeKey === 'string' && envelope.scopeKey.length > 0) {
      return envelope as EventEnvelope;
    }
    return null;
  } catch {
    return null;
  }
}

export async function shouldDeliverEvent(
  envelope: EventEnvelope,
  userKey: string,
  collectionAccess: (userKey: string, collectionKey: string, event: AppEventSlug) => Promise<boolean>,
  scopeAccess: (userKey: string, scopeKey: string) => Promise<boolean> = async () => false,
) {
  if (envelope.route === 'user') return envelope.userKey === userKey;
  if (envelope.route === 'collection') return collectionAccess(userKey, envelope.collectionKey, envelope.event);
  return scopeAccess(userKey, envelope.scopeKey);
}
