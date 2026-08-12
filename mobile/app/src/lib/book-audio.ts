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
