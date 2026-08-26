export const SIGNED_MEDIA_REFRESH_AGE_MS = 12 * 60 * 1000;
export const SIGNED_MEDIA_REFRESH_RETRY_MS = 60 * 1000;

export function getBookPlaybackIdentity(userKey: string | undefined, organizationKey: string, scopeKey: string) {
  return userKey ? `${userKey}:${organizationKey}:${scopeKey}` : undefined;
}

export function getBookProgressKey(identity: string, bookKey: string, chapterKey: string) {
  return `${identity}:${bookKey}:${chapterKey}`;
}

export function shouldRefreshSignedMedia(input: {
  force: boolean;
  playbackFailed: boolean;
  loadedAt: number;
  lastAttemptAt?: number;
  now: number;
}) {
  if (input.force) return true;
  const retryAllowed = !input.lastAttemptAt || input.now - input.lastAttemptAt >= SIGNED_MEDIA_REFRESH_RETRY_MS;
  return retryAllowed && (input.playbackFailed || input.now - input.loadedAt >= SIGNED_MEDIA_REFRESH_AGE_MS);
}
