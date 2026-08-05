import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { CONTACT_COPY } from "@/lib/legal-copy";

export const metadata: Metadata = {
  title: "Contact",
  description: "Reach Vorinthex AI at contact@vorinthex.com.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return <LegalPage copy={CONTACT_COPY} />;
}
