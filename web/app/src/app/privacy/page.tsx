import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
import { PRIVACY_COPY } from "@/lib/legal-copy";

export const metadata: Metadata = {
  title: "Privacy Policy and Data Deletion",
  description:
    "Learn how Vorinthex AI handles personal data and how to request account or selected data deletion.",
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
        {PRIVACY_COPY.sections?.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 24)}>{paragraph}</p>
            ))}
          </section>
        ))}
      </article>
    </>
  );
}
