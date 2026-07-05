import type { ReactNode } from "react";

import { verifySession } from "@/server/dal/session";

import { SignOutButton } from "./sign-out-button";

export default async function ConsoleLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await verifySession();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <span className="cui-label">Cortex Orbit</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">{session.displayName}</span>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
