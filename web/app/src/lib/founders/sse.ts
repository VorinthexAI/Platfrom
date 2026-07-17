/**
 * Incremental server-sent-events parser for fetch ReadableStreams. Feed it
 * decoded text chunks in any split; it returns completed events as they
 * close. Handles `\n` and `\r\n` delimiters, multi-line `data:` fields, and
 * ignores comment lines.
 */

export interface SseEvent {
  event: string;
  data: string;
}

export function createSseParser() {
  let buffer = "";

  function parseFrame(frame: string): SseEvent | null {
    let event = "message";
    const data: string[] = [];
    for (const rawLine of frame.split("\n")) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line || line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator === -1 ? line : line.slice(0, separator);
      let value = separator === -1 ? "" : line.slice(separator + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length === 0) return null;
    return { event, data: data.join("\n") };
  }

  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk;
      const events: SseEvent[] = [];
      let boundary = findBoundary(buffer);
      while (boundary) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const parsed = parseFrame(frame);
        if (parsed) events.push(parsed);
        boundary = findBoundary(buffer);
      }
      return events;
    },
  };
}

function findBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}
