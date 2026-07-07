export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://vorinthex.com"
).replace(/\/$/, "");

export const BLOCK_INDEXING =
  process.env.NEXT_PUBLIC_BLOCK_INDEXING === "true";

export const SITE_NAME = "Vorinthex AI";
export const SITE_TAGLINE = "The Nexus of Intelligence";

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path === "/" ? "" : path}`;
}
