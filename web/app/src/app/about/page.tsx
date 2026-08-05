import type { Metadata } from "next";
import { AboutPage } from "@/components/about/AboutPage";

export const metadata: Metadata = {
  title: "About Vorinthex",
  description:
    "Vorinthex is an AI-native software company building Core, one private personal AI that learns, remembers, and grows with you.",
  alternates: { canonical: "/about" },
};

export default function AboutPageRoute() {
  return <AboutPage />;
}
