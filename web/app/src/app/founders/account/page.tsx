import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Account — Founders Gate",
  description: "Your Vorinthex founder identity.",
  robots: { index: false, follow: false },
};

export default function FoundersAccountRoute() {
  redirect("/nexus/account");
}
