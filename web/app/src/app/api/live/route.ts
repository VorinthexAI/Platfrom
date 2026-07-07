import { backendStream } from "@/lib/backend";
import { getProgress } from "@/lib/fragments/fragments-server";

export const dynamic = "force-dynamic";

/**
 * Live counters as Server-Sent Events. When the platform backend is
 * configured this proxies its /live/stream (waitlist + fragments counts,
 * pushed in real time); the API key stays server-side. Without a backend
 * it synthesizes the same event shape from the local fragments ledger so
 * the landing page's live UI works in frontend-only development.
 */
export async function GET() {
  const upstream = await backendStream("/live/stream");
  if (upstream?.body) {
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // Local fallback stream.
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const emit = () => {
        const progress = getProgress();
        const payload = JSON.stringify({
          waitlist_count: 0,
          waitlist_verified_count: 0,
          fragments_total: progress.total,
          fragments_entries: progress.claimed.length,
        });
        controller.enqueue(
          encoder.encode(`event: counters\ndata: ${payload}\n\n`),
        );
      };
      emit();
      interval = setInterval(emit, 5000);
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
