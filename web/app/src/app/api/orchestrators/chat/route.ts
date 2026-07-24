import { NextResponse } from "next/server";
import { backendStream } from "@/lib/backend";
import { applyFoundersSessionRotation, foundersAuthHeaders } from "@/lib/founders/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("orchestrator_slug");
  if (!slug || !/^[a-z]+(?:-[a-z]+)*$/.test(slug) || url.searchParams.size !== 1) {
    return NextResponse.json({ error: "invalid orchestrator" }, { status: 400 });
  }

  const upstream = await backendStream(`/orchestrators/chat?${new URLSearchParams({ orchestrator_slug: slug })}`, {
    method: "POST",
    body: await request.text(),
    headers: {
      ...await foundersAuthHeaders(),
      "Content-Type": "application/json",
      ...(request.headers.get("x-forwarded-for") ? { "X-Forwarded-For": request.headers.get("x-forwarded-for")! } : {}),
    },
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
