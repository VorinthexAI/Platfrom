import type { Metadata } from "next";
import { PrivateGalaxy } from "./PrivateGalaxy";

export const metadata: Metadata = {
  title: "Private Galaxy",
  description: "Vorinthex members area.",
  robots: { index: false, follow: false },
};

export default function PrivateGalaxyPage() {
  return <PrivateGalaxy />;
}
