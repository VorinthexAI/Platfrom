import type { Metadata } from "next";
import { FoundersAccountPage } from "@/components/founders/FoundersAccountPage";

export const metadata: Metadata = {
  title: "Account — Nexus",
  description: "Your Vorinthex founder identity.",
  robots: { index: false, follow: false },
};

export default function NexusAccountPage() {
  return <FoundersAccountPage />;
}
