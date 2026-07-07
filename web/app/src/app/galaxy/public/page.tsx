import type { Metadata } from "next";
import { PublicGalaxy } from "./PublicGalaxy";

export const metadata: Metadata = {
  title: "Your Galaxy",
  description: "Your Vorinthex explorer profile and Intelligence Fragments.",
  robots: { index: false, follow: false },
};

export default function PublicGalaxyPage() {
  return <PublicGalaxy />;
}
