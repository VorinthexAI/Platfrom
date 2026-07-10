import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
import { ABOUT_COPY } from "@/lib/legal-copy";

export const metadata: Metadata = {
  title: "About",
  description:
    "Vorinthex is an AI-native software company building the operating system for AI-powered work.",
  alternates: { canonical: "/about" },
};

/**
 * The company story is read inside an asteroid — the Origin Vault. The
 * copy stays server-rendered (visually hidden) for crawlers.
 */
export default function AboutPage() {
  return (
    <>
      <LandingPage initialCave="about" />
      <article className="sr-only">
        <h1>{ABOUT_COPY.title}</h1>
        {ABOUT_COPY.paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 24)}>{paragraph}</p>
        ))}
      </article>
    </>
  );
}
