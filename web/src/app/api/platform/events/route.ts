import { NextResponse } from "next/server";
import { z } from "zod";

import { backendFetch } from "@/server/backend-client";

const platformEventSchema = z.object({
  distinctId: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  slug: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = platformEventSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid event payload." },
      { status: 400 },
    );
  }

  let backendRes: Response;
  try {
    backendRes = await backendFetch("/platform/events", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
  } catch {
    return NextResponse.json(
      { message: "Couldn't record event." },
      { status: 502 },
    );
  }

  if (!backendRes.ok) {
    const data = await backendRes.json().catch(() => null);
    return NextResponse.json(
      data ?? { message: "Couldn't record event." },
      { status: backendRes.status },
    );
  }

  return new Response(null, { status: 204 });
}
