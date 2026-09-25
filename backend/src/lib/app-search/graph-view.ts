import type { Database } from 'arangojs';

/** Search-only projection. ArangoDB updates links as the source documents change. */
export const WORKSPACE_SEARCH_VIEW = 'workspaceResourceSearch';

export const WORKSPACE_SEARCH_FIELDS = {
  folders: ['name', 'description'],
  documents: ['name', 'content'],
  collections: ['name', 'description'],
  images: ['filename', 'caption', 'placeName', 'placeSummary'],
  imageCollectionMemories: ['text'],
  visualIdentities: ['name', 'description'],
  emailInboxes: ['name', 'description'],
  emailThreads: ['subject', 'summary', 'intent'],
  emailMessages: ['subject', 'body', 'summary'],
  emailDrafts: ['subject', 'generatedContent', 'finalContent'],
  emailTones: ['name', 'instruction'],
  emailReplyContext: ['name', 'text'],
  places: ['name', 'summary'],
  trips: ['name', 'description'],
  tripGuides: ['name', 'content'],
  placeReferences: ['name', 'content'],
  books: ['title', 'description'],
  bookChapters: ['title', 'content'],
  tags: ['name', 'description'],
  tickets: ['message'],
  userNotifications: ['title', 'message'],
} as const;

export async function ensureWorkspaceSearchView(database: Database) {
  const links = Object.fromEntries(Object.entries(WORKSPACE_SEARCH_FIELDS).map(([name, fields]) => [name, {
    includeAllFields: false,
    fields: {
      scopeKey: { analyzers: ['identity'] },
      ...Object.fromEntries(fields.map((field) => [field, { analyzers: ['text_en'], includeAllFields: false }])),
    },
  }]));
  const view = database.view(WORKSPACE_SEARCH_VIEW);
  if (await view.exists()) await view.updateProperties({ links });
  else await view.create({ type: 'arangosearch', links });
}
