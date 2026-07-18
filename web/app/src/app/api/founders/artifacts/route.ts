import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/backend";
import { applyFoundersSessionRotation, foundersAuthHeaders } from "@/lib/founders/server";

export const dynamic = "force-dynamic";

async function proxy(request: Request, method: "GET" | "POST") {
  const url = new URL(request.url);
  const result = await backendFetch(`/founders/artifacts${url.search}`, {
    method,
    headers: await foundersAuthHeaders(),
    ...(method === "POST" ? { body: await request.text() } : {}),
  });
  const response = NextResponse.json(result.data ?? { error: "backend unavailable" }, { status: result.ok ? (method === "POST" ? 201 : 200) : result.status });
  applyFoundersSessionRotation(response, result.headers);
  return response;
}

export function GET(request: Request) { return proxy(request, "GET"); }
export function POST(request: Request) { return proxy(request, "POST"); }
