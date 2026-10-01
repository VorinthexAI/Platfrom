import type { Database } from 'arangojs';

export const WORKSPACE_SEARCH_VIEW = 'workspaceResourceSearch';

export const WORKSPACE_SEARCH_FIELDS = {
  folders: ['name', 'description'],
  files: ['name', 'extractedText'],
} as const;

export async function ensureWorkspaceSearchView(database: Database) {
  const links = Object.fromEntries(Object.entries(WORKSPACE_SEARCH_FIELDS).map(([name, fields]) => [name, {
    includeAllFields: false,
    fields: {
      scopeKey: { analyzers: ['identity'] },
      userKey: { analyzers: ['identity'] },
      ...Object.fromEntries(fields.map((field) => [field, { analyzers: ['text_en'], includeAllFields: false }])),
    },
  }]));
  const view = database.view(WORKSPACE_SEARCH_VIEW);
  if (await view.exists()) await view.updateProperties({ links });
  else await view.create({ type: 'arangosearch', links });
}
