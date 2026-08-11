const TOKEN_HASH = /^[a-f0-9]{64}$/;

function backendUrl(path: string) {
  const base = process.env.BACKEND_API_URL ?? "http://localhost:3001";
  return `${base.replace(/\/$/, "")}/api/v1${path}`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).length !== 1 || typeof body.token_hash !== "string" || !TOKEN_HASH.test(body.token_hash)) {
    return Response.json({ error: "invalid sign-in link" }, { status: 400 });
  }

  const response = await fetch(backendUrl("/auth/magic/validate"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Vorinthex-API-Key": process.env.BACKEND_API_KEY ?? "",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const headers = new Headers({ "Content-Type": response.headers.get("content-type") ?? "application/json" });
  for (const cookie of response.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
  return new Response(await response.text(), { status: response.status, headers });
}
