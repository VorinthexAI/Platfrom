import type { Book, BookChapter } from "@/lib/books-client";

export const BOOK_AUDIO_MODE = {
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  interruptionMode: "doNotMix",
  allowsRecording: false,
  shouldRouteThroughEarpiece: false,
} as const;

export function bookAudioMetadata(book: Book, chapter: BookChapter) {
  return {
    title: chapter.title,
    artist: "Vorinthex Ascend",
    albumTitle: book.title,
    ...(book.coverUrl ? { artworkUrl: book.coverUrl } : {}),
  };
}

export function clampBookSeek(seconds: number, duration: number) {
  return Math.max(0, Math.min(Math.max(0, duration), seconds));
}

export function adjacentBookChapter(chapters: readonly BookChapter[], chapterKey: string | undefined, offset: -1 | 1) {
  const ordered = [...chapters].sort((left, right) => left.position - right.position);
  const index = ordered.findIndex(({ key }) => key === chapterKey);
  return index < 0 ? undefined : ordered[index + offset];
}
