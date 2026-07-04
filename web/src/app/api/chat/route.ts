// neural-map.md §7.3/§17.5 — the chat proxy route.
//   POST: streams a completion. Verifies the session, forwards the request
//         to the backend's `/chat/completions`, and adapts its SSE stream
//         into an AI SDK v6 UIMessageStreamResponse via
//         `toUIMessageStreamResponse` (kept in its own file so this seam is
//         isolated and easy to fix once a real backend exists).
//   GET:  not part of the AI SDK v6 chat protocol — backs
//         `useChatHistory`'s older-message pagination (§7.4/§34.5), proxied
//         through this same route so the browser never needs a direct,
//         credentialed link to the backend.
import type { NextRequest } from "next/server";
import { backendFetch, backendFetchStream } from "@/server/backend-client";
import { verifySessionForRoute } from "@/server/dal/session";
import { toUIMessageStreamResponse } from "./backend-stream-adapter";

export async function POST(req: Request) {
  const session = await verifySessionForRoute();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const backendResponse = await backendFetchStream("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, userId: session.userId }),
  });

  if (!backendResponse.ok || !backendResponse.body) {
    // §51.2's copy for this exact failure mode is owned by the composer UI;
    // this just needs to be a non-2xx JSON response for it to react to.
    return Response.json({ error: "Couldn't send that. Retry?" }, { status: backendResponse.status || 502 });
  }

  return toUIMessageStreamResponse(backendResponse);
}

export async function GET(req: NextRequest) {
  const session = await verifySessionForRoute();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threadId = req.nextUrl.searchParams.get("threadId");
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;

  if (!threadId || threadId === "new") {
    return Response.json({ messages: [], nextCursor: null });
  }

  const path = `/chat/threads/${threadId}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
  const backendResponse = await backendFetch(path);

  if (!backendResponse.ok) {
    return Response.json({ error: "Failed to load messages" }, { status: backendResponse.status });
  }

  const data = await backendResponse.json();
  return Response.json(data);
}
