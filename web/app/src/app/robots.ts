import type { MetadataRoute } from "next";
import { BLOCK_INDEXING, SITE_URL } from "@/lib/site";

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
      },
      {
        userAgent: AI_CRAWLERS,
        allow: "/",
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
