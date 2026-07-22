import type { Metadata } from "next";
import { NexusEntry } from "../../NexusEntry";

export const metadata: Metadata = {
  title: "The Nexus Deck",
  description: "Inside the Vorinthex Nexus deck.",
  robots: { index: false, follow: false },
};

export default function NexusDeckPage() {
  return <NexusEntry />;
}
