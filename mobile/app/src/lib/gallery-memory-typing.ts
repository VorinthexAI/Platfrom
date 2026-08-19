export const MEMORY_TYPING_MIN_MS = 2_000;
export const MEMORY_TYPING_MAX_MS = 3_000;

export function galleryMemoryTypingDuration(text: string) {
  if (!text.length) return 0;
  return Math.round(MEMORY_TYPING_MIN_MS + Math.min(1, text.length / 600) * (MEMORY_TYPING_MAX_MS - MEMORY_TYPING_MIN_MS));
}

export function galleryMemoryTypedText(text: string, elapsedMs: number, durationMs = galleryMemoryTypingDuration(text)) {
  if (!text.length || durationMs <= 0 || elapsedMs >= durationMs) return text;
  if (elapsedMs <= 0) return "";
  return text.slice(0, Math.floor(text.length * elapsedMs / durationMs));
}

export function splitGalleryMemoryText(text: string) {
  return text.split(/\n\s*\n/).filter((section) => section.length > 0);
}
