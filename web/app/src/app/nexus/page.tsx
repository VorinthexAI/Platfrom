import type { Metadata } from "next";
import { NexusGate } from "./NexusGate";

export const metadata: Metadata = {
  title: "The Nexus",
  description: "Inside the Vorinthex star.",
  robots: { index: false, follow: false },
};

export default function NexusPage() {
  return <NexusGate />;
}
