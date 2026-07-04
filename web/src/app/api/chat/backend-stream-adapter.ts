// Isolates the seam between the backend's raw SSE protocol and the AI SDK v6
// UIMessage stream protocol our client (`useConsoleChat`) expects. Per
// neural-map.md §7.3: the backend never needs to natively speak the AI SDK's
// wire format — this file is the only place that needs to know both shapes.
// When a real backend replaces the mock, only `parseBackendEvent` below
// should need to change.
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

type BackendStreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "error"; errorText: string }
  | { type: "done" };

/**
 * Adapts the backend's SSE stream — `data: {"type":"text-delta","delta":"..."}`
 * events, terminated by a literal `data: [DONE]` (per §47's mock backend
 * sketch, `POST /api/v1/chat/completions`) — into an AI SDK v6
 * `UIMessageStreamResponse`. Also forwards the backend's `X-Thread-Id`
 * response header (readable before the stream body starts) onto the
 * response handed back to the client, which is how `useConsoleChat`
 * discovers the real thread id for §7.8's optimistic-id reconciliation.
 */
export function toUIMessageStreamResponse(backendResponse: Response): Response {
  if (!backendResponse.body) {
    throw new Error("toUIMessageStreamResponse: backend response has no readable body");
  }
  const backendBody = backendResponse.body;

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      const textId = "0";
      let textStarted = false;
      let finishReason: "stop" | "error" = "stop";

      try {
        for await (const event of parseBackendEventStream(backendBody)) {
          if (event.type === "text-delta") {
            if (!textStarted) {
              writer.write({ type: "text-start", id: textId });
              textStarted = true;
            }
            writer.write({ type: "text-delta", id: textId, delta: event.delta });
          } else if (event.type === "error") {
            finishReason = "error";
            writer.write({ type: "error", errorText: event.errorText });
          }
          // "done" simply ends the generator (see below) — no chunk of its
          // own, since the "finish" chunk written in `finally` plays that role.
        }
      } catch (error) {
        // An AbortError means the client called stop() (§7.7) — an expected,
        // non-erroneous end of stream, not a failure to surface to the user.
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          finishReason = "error";
          writer.write({
            type: "error",
            errorText: error instanceof Error ? error.message : "The connection dropped partway through.",
          });
        }
      } finally {
        if (textStarted) writer.write({ type: "text-end", id: textId });
        writer.write({ type: "finish", finishReason });
      }
    },
    onError: (error) => (error instanceof Error ? error.message : "Something went wrong while streaming the response."),
  });

  const response = createUIMessageStreamResponse({ stream });
  const headers = new Headers(response.headers);
  const threadId = backendResponse.headers.get("X-Thread-Id");
  if (threadId) headers.set("X-Thread-Id", threadId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function* parseBackendEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<BackendStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseBackendEvent(rawEvent);
        if (event) {
          yield event;
          if (event.type === "done") return;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }

    const trailing = parseBackendEvent(buffer);
    if (trailing) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

function parseBackendEvent(rawEvent: string): BackendStreamEvent | null {
  const dataLines = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) return null;

  const data = dataLines.join("\n");
  if (data === "[DONE]") return { type: "done" };

  try {
    const parsed = JSON.parse(data) as { type?: string; delta?: string; error?: string };
    if (parsed.type === "text-delta" && typeof parsed.delta === "string") {
      return { type: "text-delta", delta: parsed.delta };
    }
    if (parsed.type === "error") {
      return { type: "error", errorText: parsed.error ?? "The assistant hit an error." };
    }
    // Forward-compatible: any other event type the backend starts emitting
    // later (tool calls, reasoning, etc.) is silently ignored here today —
    // this is the exact spot to extend when that happens.
    return null;
  } catch {
    return null;
  }
}
