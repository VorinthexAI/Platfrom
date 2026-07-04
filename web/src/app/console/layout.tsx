// neural-map.md §5.1, §6.1 — the console shell's root layout. This is a
// Server Component: it verifies the session server-side, then hands off to
// the client `ConsoleShell`, which owns the header, floating island, and
// off-tree chat/universe panel mounting (see console-shell.tsx).
//
// Per §7.10's nuance, this layout's own `verifySession()` call is the one
// place in the console tree that is allowed to hard-redirect on failure
// rather than render unauthorized.tsx — there is no shell yet to preserve
// at this boundary. Narrower, leaf-level session checks (e.g. inside a
// specific Server Action) are what should invoke `unauthorized()` and
// render `./unauthorized.tsx` in place, per that same section.

import type { ReactNode } from "react";

import { verifySession } from "@/server/dal/session";
import { ConsoleShell } from "@/features/console/console-shell";

import "./console-theme.css";

export default async function ConsoleLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await verifySession();
  return <ConsoleShell session={session}>{children}</ConsoleShell>;
}
