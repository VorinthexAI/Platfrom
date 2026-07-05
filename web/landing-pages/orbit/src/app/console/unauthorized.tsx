// Rendered via Next's `unauthorized()` convention from narrow, leaf-level
// session checks (e.g. inside a Server Action). Not wired up anywhere yet —
// kept in place as the file Next's convention requires for any future call
// site, matching console/layout.tsx's own comment about hard-redirecting
// instead at the shell level.

import Link from "next/link";

import { Button, Card } from "@vorinthex/shared/ui";

export default function ConsoleUnauthorized() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md text-center" role="alertdialog">
        <h1 className="text-2xl font-normal">Your session needs a quick re-verify.</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          For your security, please confirm it&apos;s still you.
        </p>
        <Button asChild className="mt-6 w-full" variant="primary">
          <Link href="/signin">Verify it&apos;s you</Link>
        </Button>
      </Card>
    </div>
  );
}
