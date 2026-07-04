// neural-map.md §3.2, §4.4, §7.10, §22.3, §51.1 — the in-place "session
// expired" UI rendered by Next's `unauthorized()` file convention.
//
// IMPORTANT: per §7.10, this file must only ever be reached via a narrow,
// leaf-level `unauthorized()` call (e.g. inside a Server Action's own
// session check) — never wired at `console/layout.tsx`'s own
// `verifySession()` call, which hard-redirects instead (see layout.tsx's
// comment). That's what keeps this a small in-place dialog rather than a
// full replacement of the still-mounted shell/composer.

import Link from "next/link";

export default function ConsoleUnauthorized() {
  return (
    <div className="vx-console-unauthorized" data-console-theme="dark">
      <div className="vx-console-unauthorized-card" role="alertdialog" aria-labelledby="vx-unauthorized-heading">
        <h1 id="vx-unauthorized-heading">Your session needs a quick re-verify</h1>
        <p>
          For your security, please confirm it&rsquo;s still you. Nothing you
          were doing will be lost.
        </p>
        <Link href="/signin" className="vx-console-unauthorized-action">
          Verify it&rsquo;s you
        </Link>
      </div>
    </div>
  );
}
