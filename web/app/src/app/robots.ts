import type { MetadataRoute } from "next";
import { BLOCK_INDEXING, SITE_URL } from "@/lib/site";

/**
 * Private, auth, and deep-link surfaces that must never be indexed or
 * crawled. Each page already exports `robots: { index: false }`, but the
 * robots.txt disallow keeps well-behaved crawlers (including AI agents) out
 * of them entirely.
 */
const DISALLOW_PRIVATE = ["/auth", "/signin", "/galaxy", "/nexus", "/public/"];

/**
 * GEO / AEO allowlist: answer engines and AI crawlers we explicitly welcome
 * in production so Vorinthex can be discovered, cited, and recommended.
 * Private paths stay disallowed for them too.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "Google-Extended",
  "PerplexityBot",
  "Applebot-Extended",
  "CCBot",
  "Bytespider",
  "cohere-ai",
];

export default function robots(): MetadataRoute.Robots {
  // Staging/preview builds must never be indexed or crawled — by anyone,
  // including AI agents.
  if (BLOCK_INDEXING) {
    return {
      rules: { userAgent: "*", disallow: "/" },
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW_PRIVATE,
      },
      {
        userAgent: AI_CRAWLERS,
        allow: "/",
        disallow: DISALLOW_PRIVATE,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
