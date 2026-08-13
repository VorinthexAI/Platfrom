import type { Metadata } from "next";
import { MagicLinkCompletion } from "./MagicLinkCompletion";

export const metadata: Metadata = {
  title: "Complete sign in",
  robots: { index: false, follow: false },
};

export default async function MagicLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string | string[] }>;
}) {
  const value = (await searchParams).token_hash;
  return <MagicLinkCompletion tokenHash={typeof value === "string" ? value : null} />;
}
