import type { AppSearchCollectionSlug } from '@/lib/app-search/service';

/** Specialized text searches superseded by app.search on model-facing workspace surfaces. */
export const APP_SEARCH_COLLECTIONS_BY_OVERLAPPING_TOOL = Object.freeze({
  'folder.find': ['folders'],
  'folder.list': ['folders'],
  'document.find': ['documents', 'files'],
  'document.list': ['documents', 'files'],
  'document.read': ['documents', 'files'],
  'content.search': ['folders', 'documents', 'files'],
  'document.search': ['documents', 'files'],
  'document.search-all': ['documents', 'files'],
  'country.search': ['countries'],
  'place.search': ['places'],
  'place.find': ['places'],
  'trip.search': ['trips'],
  'inbox.search': ['inboxes'],
  'email.tone.search': ['email-tones'],
  'email.tone.list': ['email-tones'],
  'email.overview': ['inboxes', 'email-messages', 'email-drafts'],
  'email.thread.read': ['email-messages'],
  'collection.list': ['collections', 'images'],
  'place.list': ['places'],
  'trip.list': ['trips'],
  'book.list': ['books'],
  'book.detail': ['books'],
} as const satisfies Record<string, readonly AppSearchCollectionSlug[]>);

export const APP_SEARCH_OVERLAPPING_TOOL_NAMES = Object.freeze(Object.keys(APP_SEARCH_COLLECTIONS_BY_OVERLAPPING_TOOL));
export const APP_SEARCH_OVERLAPPING_TOOL_NAME_SET: ReadonlySet<string> = new Set(APP_SEARCH_OVERLAPPING_TOOL_NAMES);
