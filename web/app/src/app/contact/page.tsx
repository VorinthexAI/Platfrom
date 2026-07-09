import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Contact | Vorinthex AI",
  description:
    "Reach the Vorinthex AI team at support@vorinthex.com — questions, access, press, and partnerships.",
  alternates: { canonical: "/contact" },
};

/**
 * The contact page: the same chrome panel as /about, kept short — one
 * address answers everything.
 */
export default function ContactPage() {
  return (
    <main className="obsidian-noise flex min-h-svh items-center justify-center px-4 py-16 sm:px-6">
      <article
        className="chrome-border card-depth w-full max-w-2xl rounded-3xl p-8 sm:p-12"
        style={{ background: "var(--gradient-panel)" }}
      >
        <p className="micro-label">Contact</p>
        <h1 className="font-display mt-4 text-3xl leading-snug tracking-[0.08em] text-silver-50 sm:text-4xl">
          Talk to Vorinthex.
        </h1>

        <div className="mt-10 space-y-8">
          <section>
            <p className="font-mono text-[0.55rem] tracking-[0.28em] text-silver-500 uppercase">
              One address for everything
            </p>
            <p className="mt-3 text-[0.95rem] leading-relaxed text-silver-200">
              Questions, access, press, partnerships, or removing your data —
              it all lands in the same inbox, and we read everything.
            </p>
            <a
              href="mailto:support@vorinthex.com"
              className="mt-5 inline-block font-mono text-sm tracking-[0.08em] text-silver-50 underline decoration-white/25 underline-offset-4 transition-colors hover:decoration-white/60"
            >
              support@vorinthex.com
            </a>
          </section>
        </div>

        <div className="mt-12 flex flex-col gap-5 border-t border-white/8 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.7rem] text-silver-700">
            Curious who we are? Read the story on the About page.
          </p>
          <div className="flex gap-3">
            <Link
              href="/about"
              className="vui-button vui-button-secondary min-h-0 px-6 py-3 text-[0.62rem] uppercase"
            >
              About
            </Link>
            <Link
              href="/"
              className="vui-button vui-button-secondary min-h-0 px-6 py-3 text-[0.62rem] uppercase"
            >
              Enter the galaxy
            </Link>
          </div>
        </div>
      </article>
    </main>
  );
}
