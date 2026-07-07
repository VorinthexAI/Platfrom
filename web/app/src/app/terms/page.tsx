import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
import { TERMS_COPY } from "@/lib/legal-copy";

export const metadata: Metadata = {
  title: "Terms",
  description: "Vorinthex AI terms.",
  alternates: { canonical: "/terms" },
};

/**
 * The terms are read inside an asteroid — the Accord Vault. The copy
 * stays server-rendered (visually hidden) for crawlers.
 */
export default function TermsPage() {
  return (
    <>
      <LandingPage initialCave="terms" />
      <article className="sr-only">
        <h1>{TERMS_COPY.title}</h1>
        {TERMS_COPY.paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 24)}>{paragraph}</p>
        ))}
      </article>
    </>
  );
}
