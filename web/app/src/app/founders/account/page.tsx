import type { Metadata } from "next";
import { FoundersAccountPage } from "@/components/founders/FoundersAccountPage";

export const metadata: Metadata = {
  title: "Account — Founders Gate",
  description: "Your Vorinthex founder identity.",
  robots: { index: false, follow: false },
};

export default function FoundersAccountRoute() {
  return <FoundersAccountPage />;
}
