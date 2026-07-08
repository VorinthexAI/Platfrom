import type { MetadataRoute } from "next";
import { getIndexableEntities } from "@/lib/galaxy/registry-helpers";
import { absoluteUrl } from "@/lib/site";

/** Sitemap generated from the registry — hidden entities never appear. */
export default function sitemap(): MetadataRoute.Sitemap {
  const entityEntries = getIndexableEntities().map((entity) => ({
    url: absoluteUrl(entity.routes.path),
    changeFrequency: "weekly" as const,
    priority:
      entity.type === "star"
        ? 1
        : entity.type === "product"
          ? entity.isLive
            ? 0.9
            : 0.5
          : 0.7,
  }));

  // Indexable pages that live outside the registry.
  const staticEntries = [
    { path: "/hunt", priority: 0.6 },
    { path: "/terms", priority: 0.3 },
    { path: "/privacy", priority: 0.3 },
  ].map(({ path, priority }) => ({
    url: absoluteUrl(path),
    changeFrequency: "monthly" as const,
    priority,
  }));

  return [...entityEntries, ...staticEntries];
}
