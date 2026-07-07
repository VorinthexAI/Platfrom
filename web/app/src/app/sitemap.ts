import type { MetadataRoute } from "next";
import { getIndexableEntities } from "@/lib/galaxy/registry-helpers";
import { absoluteUrl } from "@/lib/site";

/** Sitemap generated from the registry — hidden entities never appear. */
export default function sitemap(): MetadataRoute.Sitemap {
  return getIndexableEntities().map((entity) => ({
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
}
