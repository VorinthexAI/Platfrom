import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
import { CONTACT_COPY } from "@/lib/legal-copy";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Reach the Vorinthex AI team at contact@vorinthex.com — questions, access, press, and partnerships.",
  alternates: { canonical: "/contact" },
};

/**
 * The contact channel is read inside an asteroid — the Signal Vault. The
 * copy stays server-rendered (visually hidden) for crawlers.
 */
export default function ContactPage() {
  return (
    <>
      <LandingPage initialCave="contact" />
      <article className="sr-only">
        <h1>{CONTACT_COPY.title}</h1>
        {CONTACT_COPY.paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 24)}>{paragraph}</p>
        ))}
      </article>
    </>
  );
}
