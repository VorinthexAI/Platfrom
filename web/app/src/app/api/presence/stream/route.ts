import { backendStream } from "@/lib/backend";

export const dynamic = "force-dynamic";

/**
 * Presence events as Server-Sent Events, proxied from the backend so the
 * API key stays server-side: a `roster` snapshot on connect, then every
 * join/move/leave as `presence` events. Without a backend it emits an
 * empty roster and heartbeats — the galaxy is simply quiet.
 */
export async function GET() {
  const upstream = await backendStream("/presence/stream");
  if (upstream?.body) {
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("event: roster\ndata: []\n\n"));
      interval = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 25_000);
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
