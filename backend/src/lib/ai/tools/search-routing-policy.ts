export const APP_SEARCH_COLLECTIONS_BY_OVERLAPPING_TOOL = Object.freeze({
  'folder.find': ['folders'],
  'folder.list': ['folders'],
  'file.find': ['files'],
  'file.list': ['files'],
} as const);

export const APP_SEARCH_OVERLAPPING_TOOL_NAMES = Object.freeze(Object.keys(APP_SEARCH_COLLECTIONS_BY_OVERLAPPING_TOOL));
export const APP_SEARCH_OVERLAPPING_TOOL_NAME_SET: ReadonlySet<string> = new Set(APP_SEARCH_OVERLAPPING_TOOL_NAMES);
