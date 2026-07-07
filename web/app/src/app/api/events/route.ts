import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { LANDING_EVENT_SLUGS } from "@/lib/analytics-events";

const TEMP_EMAIL_HASH_COOKIE = "vx_temp_email_hash";
const TEMP_EMAIL_HASH_MAX_AGE_SECONDS = 60 * 60;

const eventBodySchema = z.strictObject({
  slug: z.enum(LANDING_EVENT_SLUGS),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function createTempEmailHash() {
  return sha256Hex(`vx_temp:${crypto.randomUUID()}:${Date.now()}`);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = eventBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid event." }, { status: 400 });
  }

  const jar = await cookies();
  const existing = jar.get(TEMP_EMAIL_HASH_COOKIE)?.value;
  const tempEmailHash = /^[a-f0-9]{64}$/.test(existing ?? "")
    ? existing!
    : await createTempEmailHash();
  const isNewHash = tempEmailHash !== existing;

  if (backendConfigured()) {
    const cookieHeader = request.headers.get("cookie");
    const authorizationHeader = request.headers.get("authorization");
    await backendFetch("/platform/events", {
      method: "POST",
      headers: {
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...(authorizationHeader ? { authorization: authorizationHeader } : {}),
      },
      body: JSON.stringify({
        distinctId: tempEmailHash,
        temp_email_hash: tempEmailHash,
        slug: parsed.data.slug,
        metadata: {
          ...parsed.data.metadata,
          temporary_identity: true,
        },
      }),
    });
  }

  const response = NextResponse.json({ ok: true });
  if (isNewHash) {
    response.cookies.set(TEMP_EMAIL_HASH_COOKIE, tempEmailHash, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: TEMP_EMAIL_HASH_MAX_AGE_SECONDS,
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return response;
}
