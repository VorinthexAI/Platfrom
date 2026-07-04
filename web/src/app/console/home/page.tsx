// neural-map.md §5.3 — /console/home is a redirect-resolving page, not a
// persistent destination. Lifted near-verbatim from the plan's code sketch:
// reads the `vx_last_mode` cookie server-side and resolves to the user's
// actual last-used mode, defaulting new users to Chat (the lower-friction
// first experience).

import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export default async function ConsoleHomePage() {
  const lastMode = (await cookies()).get("vx_last_mode")?.value; // "chat" | "universe"
  if (lastMode === "universe") redirect("/console/u");
  redirect("/console/c/new"); // "new" is a sentinel handled client-side (§7.2)
}
