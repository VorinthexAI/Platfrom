import { afterEach, describe, expect, test } from "bun:test";
import { appendThreadMessages, parseOrchestratorChatFrame, streamOrchestratorChat, updateThreadMessage } from "./orchestrator-chat";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("orchestrator chat SSE client", () => {
  test("keeps independent in-memory threads when switching orchestrators", () => {
    const atlas = { id: "atlas-user", role: "user" as const, text: "Hello Atlas" };
    const forge = { id: "forge-user", role: "user" as const, text: "Hello Forge" };
    let threads = appendThreadMessages({}, "atlas", atlas);
    threads = appendThreadMessages(threads, "forge", forge);
    threads = updateThreadMessage(threads, "atlas", atlas.id, (message) => ({ ...message, text: "Updated Atlas" }));
    expect(threads.atlas).toEqual([{ ...atlas, text: "Updated Atlas" }]);
    expect(threads.forge).toEqual([forge]);
  });

  test("parses unified SSE frames", () => {
    expect(parseOrchestratorChatFrame('event: token\r\ndata: {"text":"Hello"}')).toEqual({ type: "token", text: "Hello" });
    expect(parseOrchestratorChatFrame("event: done\ndata: {}" )).toEqual({ type: "done" });
  });

  test("posts general messages and streams chunked responses", async () => {
    let request: Request | undefined;
    globalThis.fetch = (async (input, init) => {
      request = new Request(new URL(input.toString(), "http://localhost"), init);
      const chunks = [
        'event: start\ndata: {"orchestrator_id":"key"}\n\nevent: tok',
        'en\ndata: {"text":"Hello"}\n\nevent: token\ndata: {"text":" there"}\n\nevent: done\ndata: {}\n\n',
      ];
      return new Response(new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      }), { headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;

    const events: unknown[] = [];
    await streamOrchestratorChat("atlas", "hello, how are you?", (event) => events.push(event));
    expect(request?.method).toBe("POST");
    expect(request?.url).toEndWith("/api/orchestrators/chat?orchestrator_slug=atlas");
    await expect(request?.json()).resolves.toEqual({ message: "hello, how are you?" });
    expect(events).toEqual([
      { type: "start" },
      { type: "token", text: "Hello" },
      { type: "token", text: " there" },
      { type: "done" },
    ]);
  });

  test("surfaces SSE errors", async () => {
    globalThis.fetch = (async () => new Response('event: error\ndata: {"error":"stream failed"}\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    })) as unknown as typeof fetch;
    await expect(streamOrchestratorChat("atlas", "hello", () => {})).rejects.toThrow("stream failed");
  });
});
