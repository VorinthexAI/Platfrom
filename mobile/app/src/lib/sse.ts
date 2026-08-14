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
