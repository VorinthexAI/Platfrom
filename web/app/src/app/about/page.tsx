import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { ABOUT_COPY } from "@/lib/legal-copy";

export const metadata: Metadata = {
  title: "About",
  description: "Vorinthex is building Core, your private personal AI.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return <LegalPage copy={ABOUT_COPY} />;
}
