import { expect, test } from "bun:test";
import { createChorusProxy } from "./chorus-proxy";

test("streams Chorus SSE through the Next proxy without buffering", async () => {
  const encoder = new TextEncoder();
  let releaseSecond!: () => void;
  const secondChunk = new Promise<void>((resolve) => { releaseSecond = resolve; });
  let forwardedPath = "";
  let forwardedInit: (RequestInit & { allowErrorResponse?: boolean }) | undefined;
  let rotated = false;
  const proxy = createChorusProxy({
    authHeaders: async () => ({ Authorization: "Bearer session" }),
    rotateSession: () => { rotated = true; },
    stream: async (path, init) => {
      forwardedPath = path;
      forwardedInit = init;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: start\ndata: {"channelKey":"channel"}\n\n'));
          void secondChunk.then(() => {
            controller.enqueue(encoder.encode("event: complete\ndata: {}\n\n"));
            controller.close();
          });
        },
      }), { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  const controller = new AbortController();
  const response = await proxy(new Request("https://vorinthex.com/api/founders/organizations/org/chorus/channels/channel/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", "X-Forwarded-For": "203.0.113.1" },
    body: JSON.stringify({ content: "@Atlas hello" }),
    signal: controller.signal,
  }), { params: Promise.resolve({ organizationKey: "org", chorusPath: ["channels", "channel", "messages"] }) });

  const reader = response.body!.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain("event: start");
  expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
  expect(forwardedPath).toBe("/founders/organizations/org/chorus/channels/channel/messages");
  expect(forwardedInit).toMatchObject({ method: "POST", body: JSON.stringify({ content: "@Atlas hello" }), allowErrorResponse: true });
  expect(forwardedInit?.headers).toMatchObject({ Authorization: "Bearer session", Accept: "text/event-stream", "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.1" });
  expect(forwardedInit?.signal).toBe(controller.signal);
  expect(rotated).toBe(true);

  releaseSecond();
  const second = await reader.read();
  expect(new TextDecoder().decode(second.value)).toContain("event: complete");
});
