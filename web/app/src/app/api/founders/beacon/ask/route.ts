import { NextResponse } from "next/server";
import { backendConfigured, backendStream } from "@/lib/backend";
import { foundersAuthHeaders } from "@/lib/founders/server";

export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

/** Local dev stub stream so the island is exercisable without a backend. */
function devStubStream(): Response {
  const encoder = new TextEncoder();
  const chunks = [
    "event: response.started\ndata: {}\n\n",
    'event: response.delta\ndata: {"text":"Beacon is running against the local dev stub — "}\n\n',
    'event: response.delta\ndata: {"text":"configure BACKEND_API_URL to reach the real runtime."}\n\n',
    "event: response.completed\ndata: {}\n\n",
  ];
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

/**
 * Streams one Beacon ask through the backend. The browser never reaches an
 * AI provider — this proxies the backend's SSE response verbatim, and the
 * backend resolves agent, model, and provider entirely server-side.
 */
export async function POST(request: Request) {
  const body = await request.text();
  if (!backendConfigured()) return devStubStream();
  const upstream = await backendStream("/founders/beacon/ask", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", ...(await foundersAuthHeaders()) },
    signal: request.signal,
    allowErrorResponse: true,
  });
  if (!upstream) {
    return NextResponse.json({ error: "backend unavailable" }, { status: 502 });
  }
  if (!upstream.ok) {
    const data = await upstream.json().catch(() => null);
    return NextResponse.json(data ?? { error: "request failed" }, { status: upstream.status });
  }
  return new Response(upstream.body, { headers: SSE_HEADERS });
}
