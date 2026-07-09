import type { Metadata } from "next";
import { SunGalaxy } from "./SunGalaxy";

export const metadata: Metadata = {
  title: "The Inner Galaxy",
  description: "Inside the Vorinthex star.",
  robots: { index: false, follow: false },
};

export default function SunGalaxyPage() {
  return <SunGalaxy />;
}
