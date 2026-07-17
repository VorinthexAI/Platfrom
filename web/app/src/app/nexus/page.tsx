import type { Metadata } from "next";
import { backendFetch } from "@/lib/backend";
import { foundersAuthHeaders } from "@/lib/founders/server";
import { FoundersGateApp } from "@/components/founders/FoundersGateApp";
import { NexusGate } from "./NexusGate";

export const metadata: Metadata = {
  title: "The Nexus",
  description: "Inside the Vorinthex star.",
  robots: { index: false, follow: false },
};

export default async function NexusPage() {
  const session = await backendFetch("/founders/me", {
    headers: await foundersAuthHeaders(),
  });
  if (session.ok) return <FoundersGateApp />;

  return <NexusGate />;
}
