import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { PRIVACY_COPY } from "@/lib/legal-copy";

export const metadata: Metadata = {
  title: "Privacy Policy and Data Deletion",
  description: "How Vorinthex AI handles personal data and deletion requests.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return <LegalPage copy={PRIVACY_COPY} />;
}
