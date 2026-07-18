import { NextResponse } from "next/server";
import { backendStream } from "@/lib/backend";
import { applyFoundersSessionRotation, foundersAuthHeaders } from "@/lib/founders/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const upstream = await backendStream(`/nexus/events/stream${url.search}`, {
    headers: await foundersAuthHeaders(),
    signal: request.signal,
    allowErrorResponse: true,
  });
  if (!upstream) return NextResponse.json({ error: "backend unavailable" }, { status: 502 });
  if (!upstream.ok) {
    const response = NextResponse.json(await upstream.json().catch(() => ({ error: "request failed" })), { status: upstream.status });
    applyFoundersSessionRotation(response, upstream.headers);
    return response;
  }
  const response = new NextResponse(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
  applyFoundersSessionRotation(response, upstream.headers);
  return response;
}
