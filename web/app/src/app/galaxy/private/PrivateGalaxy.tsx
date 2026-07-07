"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Arrival hall for members after the hyper jump: name, confirmation, and
 * the door onward. The real private workspace grows from here.
 */
export function PrivateGalaxy() {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const email = window.localStorage.getItem("vx_member_email");
      if (email) {
        const handle = email.split("@")[0] ?? "";
        setName(handle.charAt(0).toUpperCase() + handle.slice(1));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="obsidian-noise flex min-h-svh flex-col items-center justify-center px-5 py-16 text-center">
      <p className="micro-label">Private galaxy</p>
      <h1 className="font-display mt-5 max-w-2xl text-3xl leading-snug tracking-[0.08em] text-silver-50 uppercase sm:text-4xl">
        {name ? `${name}, welcome` : "Welcome"} to the project.
      </h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-silver-300">
        You are now a member. This side of the galaxy is being built in
        private, your cipher opens every door as they appear.
      </p>
      <div className="divider mt-10 w-40" />
      <p className="mt-6 max-w-sm text-[0.78rem] leading-relaxed text-silver-500">
        Access is sealed to your authenticator. Keep it close.
      </p>
      <Link
        href="/"
        className="vui-button vui-button-secondary mt-10 min-h-0 px-7 py-3 text-xs uppercase"
      >
        Back to the public galaxy
      </Link>
    </main>
  );
}
