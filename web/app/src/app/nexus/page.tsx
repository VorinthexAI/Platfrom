import type { Metadata } from "next";
import { NexusEntry } from "./NexusEntry";

export const metadata: Metadata = {
  title: "The Nexus",
  description: "Inside the Vorinthex star.",
  robots: { index: false, follow: false },
};

export default function NexusPage() {
  return <NexusEntry />;
}
