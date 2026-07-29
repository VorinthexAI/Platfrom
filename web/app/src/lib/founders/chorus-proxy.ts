import { NextResponse } from "next/server";
import { validateChorusProxyPath } from "./chorus-proxy-path";

type ChorusContext = { params: Promise<{ organizationKey: string; chorusPath: string[] }> };

interface ChorusProxyDependencies {
  stream(path: string, init: RequestInit & { allowErrorResponse?: boolean }): Promise<Response | null>;
  authHeaders(): Promise<Record<string, string>>;
  rotateSession(response: NextResponse, upstreamHeaders: Headers): void;
}

export function createChorusProxy(dependencies: ChorusProxyDependencies) {
  return async function proxy(request: Request, context: ChorusContext) {
    const { organizationKey, chorusPath } = await context.params;
    const url = new URL(request.url);
    const path = validateChorusProxyPath(request.method, organizationKey, chorusPath, url.searchParams);
    if (!path) return NextResponse.json({ error: "invalid Chorus endpoint" }, { status: 400 });

    const contentType = request.headers.get("content-type");
    if (request.method === "POST" && contentType?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return NextResponse.json({ error: "content type must be application/json" }, { status: 415 });
    }
    const forwardedFor = request.headers.get("x-forwarded-for");
    const upstreamPath = `/founders/organizations/${encodeURIComponent(organizationKey)}/chorus/${path}${url.search}`;
    const upstream = await dependencies.stream(upstreamPath, {
      method: request.method,
      ...(request.method === "POST" ? { body: await request.text() } : {}),
      headers: {
        ...await dependencies.authHeaders(),
        Accept: request.headers.get("accept") ?? "application/json",
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
      },
      signal: request.signal,
      allowErrorResponse: true,
    });
    if (!upstream) return NextResponse.json({ error: "backend unavailable" }, { status: 503 });

    const response = new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
        "Cache-Control": upstream.headers.get("content-type")?.includes("text/event-stream") ? "no-cache, no-transform" : "no-store",
      },
    });
    dependencies.rotateSession(response, upstream.headers);
    return response;
  };
}
