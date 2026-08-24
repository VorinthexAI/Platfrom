type SearchHistoryAppendListener = (userKey: string) => void;

const appendListeners = new Set<SearchHistoryAppendListener>();

export function userSearchHistoryQueryKey(userKey?: string) {
  return ["user-searches", userKey ?? ""] as const;
}

export function subscribeUserSearchHistoryAppends(listener: SearchHistoryAppendListener) {
  appendListeners.add(listener);
  return () => { appendListeners.delete(listener); };
}

export function publishUserSearchHistoryAppend(userKey: string) {
  if (!userKey) return;
  appendListeners.forEach((listener) => listener(userKey));
}
