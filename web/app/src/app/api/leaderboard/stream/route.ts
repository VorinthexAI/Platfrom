import { backendStream } from "@/lib/backend";
import { getProgress } from "@/lib/fragments/fragments-server";

export const dynamic = "force-dynamic";

/**
 * The galaxy leaderboard as Server-Sent Events. When the platform backend
 * is configured this proxies its /leaderboard/stream (top collectors,
 * totals, active explorers, recent collected pieces); the API key stays
 * server-side. Without a backend it synthesizes a small demo payload so
 * the leaderboard asteroid works in frontend-only development.
 */
export async function GET() {
  const upstream = await backendStream("/leaderboard/stream");
  if (upstream?.body) {
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // Local fallback stream: a believable little galaxy.
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const emit = () => {
        const progress = getProgress();
        const payload = JSON.stringify({
          top: [
            { user_id: "demo-1", alias: "Wind Surfer", total: 132000 },
            { user_id: "demo-2", alias: "Road Yokl", total: 41800 },
            { user_id: "demo-3", alias: "Galaxy Glory", total: 10230 },
            { user_id: "demo-4", alias: "Night Ranger", total: 4420 },
            { user_id: "demo-5", alias: "Dust Pilot", total: 443 },
          ],
          fragments_total: Math.max(progress.total, 189430),
          fragments_entries: Math.max(progress.claimed.length, 42),
          active_explorers: 52,
          recent: [],
        });
        controller.enqueue(
          encoder.encode(`event: leaderboard\ndata: ${payload}\n\n`),
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
