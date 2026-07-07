import { cookies } from "next/headers";
import { backendStream } from "@/lib/backend";
import { HANDOFF_COOKIE } from "@/lib/auth/handoff-cookies";

export const dynamic = "force-dynamic";

const HASH_PATTERN = /^[a-f0-9]{64}$/;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

/**
 * SSE feed for a waiting sign-in screen. The handoff secret never appears
 * in page-visible code: it rides the httpOnly cookie into this proxy,
 * which forwards the backend's stream (API key stays server-side).
 * Without a backend it synthesizes an approval so the full flow can be
 * exercised in frontend-only development.
 */
export async function GET() {
  const jar = await cookies();
  const handoff = jar.get(HANDOFF_COOKIE)?.value;
  if (!handoff || !HASH_PATTERN.test(handoff)) {
    return new Response(
      `event: handoff\ndata: {"status":"gone"}\n\n`,
      { headers: SSE_HEADERS },
    );
  }

  const upstream = await backendStream(
    `/auth/handoff/stream?handoff=${encodeURIComponent(handoff)}`,
  );
  if (upstream?.body) {
    return new Response(upstream.body, { headers: SSE_HEADERS });
  }

  // Local fallback: pending on connect, approved a few beats later.
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`event: handoff\ndata: {"status":"pending"}\n\n`),
      );
      timer = setTimeout(() => {
        controller.enqueue(
          encoder.encode(`event: handoff\ndata: {"status":"approved"}\n\n`),
        );
      }, 8000);
    },
    cancel() {
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
