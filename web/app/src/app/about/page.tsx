import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About | Vorinthex AI",
  description:
    "Vorinthex is an AI-native software company building the operating system for AI-powered work.",
  alternates: { canonical: "/about" },
};

const SECTIONS = [
  {
    label: "Who we are",
    body: "Vorinthex is an AI-native software company building the next generation of productivity tools for the AI era.",
  },
  {
    label: "Our mission",
    body: "Our mission is simple: make AI and autonomous agents accessible, practical, and useful for everyone.",
  },
  {
    label: "What we believe",
    body: "We believe AI shouldn't be fragmented across dozens of disconnected apps. Instead, people should have one intelligent platform where AI can think, collaborate, and help accomplish real work.",
  },
  {
    label: "Where we are today",
    body: "Today we're building Core, with Command, Studio, and Launch following as part of the long-term vision.",
  },
];

/**
 * The company page: one chrome panel, airy sections — the same box
 * language as the galaxy's caverns, standing still for once.
 */
export default function AboutPage() {
  return (
    <main className="obsidian-noise flex min-h-svh items-center justify-center px-4 py-16 sm:px-6">
      <article
        className="chrome-border card-depth w-full max-w-2xl rounded-3xl p-8 sm:p-12"
        style={{ background: "var(--gradient-panel)" }}
      >
        <p className="micro-label">About Vorinthex</p>
        <h1 className="font-display mt-4 text-3xl leading-snug tracking-[0.08em] text-silver-50 sm:text-4xl">
          Building the operating system for AI-powered work.
        </h1>

        <div className="mt-12 space-y-10">
          {SECTIONS.map((section) => (
            <section key={section.label}>
              <p className="font-mono text-[0.55rem] tracking-[0.28em] text-silver-500 uppercase">
                {section.label}
              </p>
              <p className="mt-3 text-[0.95rem] leading-relaxed text-silver-200">
                {section.body}
              </p>
            </section>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-5 border-t border-white/8 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.7rem] text-silver-700">
            Questions? Reach us at contact@vorinthex.com.
          </p>
          <Link
            href="/"
            className="vui-button vui-button-secondary min-h-0 self-start px-6 py-3 text-[0.62rem] uppercase sm:self-auto"
          >
            Enter the galaxy
          </Link>
        </div>
      </article>
    </main>
  );
}
