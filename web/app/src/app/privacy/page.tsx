import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
import { PRIVACY_COPY } from "@/lib/legal-copy";

export const metadata: Metadata = {
  title: "Privacy",
  description: "Vorinthex AI privacy policy.",
  alternates: { canonical: "/privacy" },
};

/**
 * The privacy policy is read inside an asteroid — the Records Vault. The
 * copy stays server-rendered (visually hidden) for crawlers.
 */
export default function PrivacyPage() {
  return (
    <>
      <LandingPage initialCave="privacy" />
      <article className="sr-only">
        <h1>{PRIVACY_COPY.title}</h1>
        {PRIVACY_COPY.paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 24)}>{paragraph}</p>
        ))}
      </article>
    </>
  );
}
