import {
  CANONICAL_ORIGIN,
  CONTACT_EMAIL,
  PRODUCT_FACTS,
  PUBLIC_DISCOVERABILITY_REGISTRY,
  canonicalUrl,
  type PublicRoutePath,
} from "@/lib/discoverability";

export const SCHEMA_IDS = {
  organization: `${CANONICAL_ORIGIN}/#organization`,
  website: `${CANONICAL_ORIGIN}/#website`,
  homePage: `${CANONICAL_ORIGIN}/#webpage`,
  software: `${CANONICAL_ORIGIN}/#core`,
} as const;

export function buildGlobalGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": SCHEMA_IDS.organization,
        name: "Vorinthex AI",
        url: CANONICAL_ORIGIN,
        logo: `${CANONICAL_ORIGIN}/logos/vorinthex-mark.png`,
        email: CONTACT_EMAIL,
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: CONTACT_EMAIL,
          url: canonicalUrl("/contact"),
        },
      },
      {
        "@type": "WebSite",
        "@id": SCHEMA_IDS.website,
        name: "Vorinthex AI",
        url: CANONICAL_ORIGIN,
        publisher: { "@id": SCHEMA_IDS.organization },
      },
    ],
  };
}

export function buildPageGraph(path: PublicRoutePath) {
  const entry = PUBLIC_DISCOVERABILITY_REGISTRY[path];
  const url = canonicalUrl(path);
  const pageId = path === "/" ? SCHEMA_IDS.homePage : `${url}#webpage`;
  const page = {
    "@type": entry.schemaPageType,
    "@id": pageId,
    url,
    name: entry.title,
    description: entry.description,
    dateModified: entry.lastModified,
    isPartOf: { "@id": SCHEMA_IDS.website },
    publisher: { "@id": SCHEMA_IDS.organization },
    ...(path === "/" && {
      mainEntity: { "@id": SCHEMA_IDS.software },
      about: { "@id": SCHEMA_IDS.software },
    }),
  };

  const graph: Record<string, unknown>[] = [page];

  if (path === "/") {
    graph.push(
      {
        "@type": "SoftwareApplication",
        "@id": SCHEMA_IDS.software,
        name: PRODUCT_FACTS.name,
        description: entry.summary,
        url,
        applicationCategory: "ProductivityApplication",
        operatingSystem: PRODUCT_FACTS.platforms.join(", "),
        publisher: { "@id": SCHEMA_IDS.organization },
        mainEntityOfPage: { "@id": pageId },
      },
    );
  }

  return { "@context": "https://schema.org", "@graph": graph };
}
