import type { Metadata } from "next";
import {
  BLOCK_INDEXING,
  SITE_NAME,
} from "@/lib/site";
import {
  PUBLIC_DISCOVERABILITY_REGISTRY,
  canonicalUrl,
  type PublicRoutePath,
} from "@/lib/discoverability";

const SOCIAL_IMAGE = {
  url: "/social-cards/vorinthex/opengraph.png",
  width: 1200,
  height: 630,
  alt: "Vorinthex AI emblem on a dark neural background",
} as const;

const TWITTER_IMAGE = {
  url: "/social-cards/vorinthex/twitter.png",
  width: 1200,
  height: 630,
  alt: SOCIAL_IMAGE.alt,
} as const;

export function buildRobotsMetadata(blockIndexing: boolean): Pick<Metadata, "robots"> {
  return blockIndexing
    ? { robots: { index: false, follow: false, nocache: true } }
    : {};
}

export function buildRouteMetadata(
  path: PublicRoutePath,
  blockIndexing = BLOCK_INDEXING,
): Metadata {
  const entry = PUBLIC_DISCOVERABILITY_REGISTRY[path];
  const url = canonicalUrl(path);

  return {
    title: { absolute: entry.title },
    description: entry.description,
    alternates: { canonical: url },
    ...buildRobotsMetadata(blockIndexing),
    openGraph: {
      title: entry.title,
      description: entry.description,
      url,
      siteName: SITE_NAME,
      type: "website",
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: entry.title,
      description: entry.description,
      images: [TWITTER_IMAGE],
    },
  };
}
