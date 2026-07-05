"use server";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";

import { backendFetch } from "@/server/backend-client";

const waitlistJoinSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email to join the list.")
    .email("Enter a valid email address."),
});

const cookieMaxAge = 60 * 60 * 24 * 400;

type BackendError = {
  error?: string | { message?: string };
  message?: string;
};

export type JoinWaitlistResult =
  | { ok: true; emailHash: string }
  | { ok: false; message: string };

export async function joinWaitlistAction(input: {
  email: string;
}): Promise<JoinWaitlistResult> {
  const parsed = waitlistJoinSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Enter a valid email address." };
  }

  const email = parsed.data.email.toLowerCase();

  let res: Response;
  try {
    res = await backendFetch("/waitlist", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  } catch {
    return { ok: false, message: "Couldn't reach the server. Try again." };
  }

  if (res.status !== 201) {
    const body = (await res.json().catch(() => null)) as BackendError | null;
    const message =
      typeof body?.error === "string"
        ? body.error
        : body?.error?.message ??
          body?.message ??
          "We couldn't join the waitlist. Try again.";

    return { ok: false, message };
  }

  const emailHash = createHash("sha256")
    .update(email)
    .digest("hex");

  const cookieStore = await cookies();
  cookieStore.set("email_hash", emailHash, {
    httpOnly: false,
    maxAge: cookieMaxAge,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  cookieStore.delete("email");
  cookieStore.delete("distictId");
  cookieStore.delete("distinctId");

  return { ok: true, emailHash };
}
