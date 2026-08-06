import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, canonicalUrl } from "@/lib/discoverability";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map(({ path, lastModified }) => ({
    url: canonicalUrl(path),
    lastModified,
  }));
}
