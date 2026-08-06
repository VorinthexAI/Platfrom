import { CANONICAL_ORIGIN, canonicalUrl } from "@/lib/discoverability";

export const SITE_URL = CANONICAL_ORIGIN;

export const BLOCK_INDEXING =
  process.env.NEXT_PUBLIC_BLOCK_INDEXING === "true";

export const SITE_NAME = "Vorinthex AI";
export const SITE_TAGLINE = "Your Personal AI";

export function absoluteUrl(path: string): string {
  return canonicalUrl(path);
}
