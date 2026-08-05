import type { Metadata } from "next";
import { CorePage } from "@/components/core/CorePage";

export const metadata: Metadata = {
  title: "Core | Your Personal AI",
  description:
    "Download Vorinthex Core, the private personal AI that connects your knowledge, memories, communication, and goals.",
  alternates: { canonical: "/" },
};

export default function CorePageRoute() {
  return <CorePage />;
}
