import { describe, expect, test } from "bun:test";

import {
  getBookPlaybackIdentity,
  getBookProgressKey,
  shouldRefreshSignedMedia,
  SIGNED_MEDIA_REFRESH_AGE_MS,
  SIGNED_MEDIA_REFRESH_RETRY_MS,
} from "./book-playback-policy";

describe("book playback identity", () => {
  test("scopes playback and progress to the authenticated user", () => {
    const first = getBookPlaybackIdentity("user-1", "org", "scope")!;
    const second = getBookPlaybackIdentity("user-2", "org", "scope")!;
    expect(first).not.toBe(second);
    expect(getBookProgressKey(first, "book", "chapter")).not.toBe(getBookProgressKey(second, "book", "chapter"));
  });

  test("has no playback identity while signed out", () => {
    expect(getBookPlaybackIdentity(undefined, "org", "scope")).toBeUndefined();
  });
});

describe("signed media refresh policy", () => {
  test("refreshes aged or failed media but not a fresh source", () => {
    expect(shouldRefreshSignedMedia({ force: false, playbackFailed: false, loadedAt: 1, now: 2 })).toBe(false);
    expect(shouldRefreshSignedMedia({
      force: false,
      playbackFailed: false,
      loadedAt: 1,
      now: 1 + SIGNED_MEDIA_REFRESH_AGE_MS,
    })).toBe(true);
    expect(shouldRefreshSignedMedia({ force: false, playbackFailed: true, loadedAt: 1, now: 2 })).toBe(true);
  });

  test("backs off automatic retries while allowing an explicit refresh", () => {
    const now = SIGNED_MEDIA_REFRESH_RETRY_MS;
    expect(shouldRefreshSignedMedia({
      force: false,
      playbackFailed: true,
      loadedAt: 0,
      lastAttemptAt: now - 1,
      now,
    })).toBe(false);
    expect(shouldRefreshSignedMedia({
      force: true,
      playbackFailed: true,
      loadedAt: 0,
      lastAttemptAt: now - 1,
      now,
    })).toBe(true);
  });
});
