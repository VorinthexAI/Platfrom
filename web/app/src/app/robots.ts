import type { MetadataRoute } from "next";
import { CANONICAL_ORIGIN } from "@/lib/discoverability";
import { BLOCK_INDEXING } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  if (BLOCK_INDEXING) {
    return {
      rules: { userAgent: "*", disallow: "/" },
    };
  }

  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${CANONICAL_ORIGIN}/sitemap.xml`,
  };
}
