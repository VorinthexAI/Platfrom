import { GALLERY_EVENT_SLUGS, isGalleryEventSlug, type GalleryEventSlug } from "./gallery-convergence";

export type ServerSentEvent = { event: string; data: string; id?: string };

export function parseServerSentEvent(frame: string): ServerSentEvent | undefined {
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];
  for (const rawLine of frame.replaceAll("\r\n", "\n").split("\n")) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const separator = rawLine.indexOf(":");
    const field = separator < 0 ? rawLine : rawLine.slice(0, separator);
    const value = separator < 0 ? "" : rawLine.slice(separator + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }
  return data.length ? { event, data: data.join("\n"), ...(id !== undefined ? { id } : {}) } : undefined;
}

export function consumeServerSentEvents(buffer: string, emit: (event: ServerSentEvent) => void) {
  const normalized = buffer.replaceAll("\r\n", "\n");
  const frames = normalized.split("\n\n");
  const remainder = frames.pop() ?? "";
  for (const frame of frames) {
    const event = parseServerSentEvent(frame);
    if (event) emit(event);
  }
  return remainder;
}

export const INVALIDATING_EVENT_SLUGS = GALLERY_EVENT_SLUGS;

export function invalidatesGalleryQueries(event: string): event is GalleryEventSlug {
  return isGalleryEventSlug(event);
}

export function eventStreamRetryDelay(attempt: number, random = Math.random) {
  const boundedAttempt = Math.max(0, Math.min(attempt, 5));
  const base = Math.min(30_000, 1_000 * 2 ** boundedAttempt);
  return Math.round(base * (0.75 + random() * 0.5));
}

export function isAuthenticatedBearerRejection(status: number, authenticateHeader: string | null, authenticated: boolean) {
  return status === 401 && Boolean(authenticateHeader?.includes("Bearer")) && authenticated;
}
