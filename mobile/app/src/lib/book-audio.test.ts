import { expect, test } from "bun:test";

import { BOOK_AUDIO_MODE, bookAudioMetadata } from "./book-audio";

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
