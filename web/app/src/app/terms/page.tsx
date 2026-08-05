import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { TERMS_COPY } from "@/lib/legal-copy";

export const metadata: Metadata = {
  title: "Terms",
  description: "Vorinthex AI terms.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <LegalPage copy={TERMS_COPY} />;
}
