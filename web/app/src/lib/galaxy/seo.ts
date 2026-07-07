import type { Metadata } from "next";
import type { GalaxyEntity } from "./registry-types";
import { absoluteUrl } from "@/lib/site";

/** Registry entity → Next.js metadata. Routes never build metadata by hand. */
export function buildMetadataFromEntity(entity: GalaxyEntity): Metadata {
  const canonical = entity.routes.canonical ?? entity.routes.path;
  const canonicalUrl = canonical.startsWith("http")
    ? canonical
    : absoluteUrl(canonical);

  return {
    title: entity.seo.title,
    description: entity.seo.description,
    keywords: entity.seo.keywords,
    alternates: { canonical: canonicalUrl },
    robots: entity.seo.indexable ? undefined : { index: false, follow: false },
    openGraph: {
      title: entity.seo.title,
      description: entity.seo.description,
      url: canonicalUrl,
      ...(entity.seo.openGraphImage
        ? { images: [entity.seo.openGraphImage] }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: entity.seo.title,
      description: entity.seo.description,
    },
  };
}
