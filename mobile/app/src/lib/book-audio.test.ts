import { expect, test } from "bun:test";

import { adjacentBookChapter, BOOK_AUDIO_MODE, bookAudioMetadata, clampBookSeek } from "./book-audio";

const book = { key: "book", title: "Clear Thinking", subtitle: "A guide", description: "Description", status: "ready", coverUrl: "https://example.com/cover.jpg", estimatedMinutes: 30, chapterCount: 1, progressPercent: 0 };
const chapter = { key: "chapter", title: "Notice the Signal", description: "Description", position: 1, progressSeconds: 0, isCompleted: false };

test("configures sustained background book playback", async () => {
  expect(BOOK_AUDIO_MODE).toEqual({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix", allowsRecording: false, shouldRouteThroughEarpiece: false });
  expect(bookAudioMetadata(book, chapter)).toEqual({ title: "Notice the Signal", artist: "Vorinthex Ascend", albumTitle: "Clear Thinking", artworkUrl: "https://example.com/cover.jpg" });

  const app = JSON.parse(await Bun.file(new URL("../../app.json", import.meta.url)).text());
  const audioPlugin = app.expo.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-audio");
  expect(audioPlugin?.[1]).toEqual({ enableBackgroundPlayback: true, enableBackgroundRecording: false, microphonePermission: false, recordAudioAndroid: false });
  expect(app.expo.android.blockedPermissions).toContain("android.permission.RECORD_AUDIO");
});

test("clamps seeks and resolves adjacent chapters in canonical order", () => {
  const first = { ...chapter, key: "first", position: 1 };
  const second = { ...chapter, key: "second", position: 2 };
  expect(clampBookSeek(-15, 120)).toBe(0);
  expect(clampBookSeek(90, 120)).toBe(90);
  expect(clampBookSeek(150, 120)).toBe(120);
  expect(adjacentBookChapter([second, first], "first", 1)?.key).toBe("second");
  expect(adjacentBookChapter([second, first], "second", -1)?.key).toBe("first");
  expect(adjacentBookChapter([second, first], "second", 1)).toBeUndefined();
});
