import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import {
  getAllEntities,
  getEntityBreadcrumbs,
  getIndexableEntities,
} from "@/lib/galaxy/registry-helpers";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { SITE_NAME, SITE_URL, absoluteUrl } from "./site";

/**
 * JSON-LD structured data, generated entirely from the galaxy registry.
 */

export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: VORINTHEX_GALAXY_REGISTRY.brand.name,
  slogan: VORINTHEX_GALAXY_REGISTRY.brand.tagline,
  url: SITE_URL,
  logo: absoluteUrl(VORINTHEX_GALAXY_REGISTRY.brand.logo.src),
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    email: "support@vorinthex.com",
    url: absoluteUrl("/contact"),
  },
};

export const webSiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: VORINTHEX_GALAXY_REGISTRY.brand.name,
  url: SITE_URL,
};

export function entityJsonLd(entity: GalaxyEntity) {
  const schemaType = entity.seo.schemaType ?? "SoftwareApplication";
  const base = {
    "@context": "https://schema.org",
    "@type": schemaType,
    name: entity.name,
    description: entity.seo.description,
    url: absoluteUrl(entity.routes.path),
  };
  if (schemaType === "SoftwareApplication") {
    // Live entities with a registry price advertise it; everything else
    // is a pre-order at no cost (waitlist access).
    const offers = {
      "@type": "Offer",
      availability: entity.isLive
        ? "https://schema.org/InStock"
        : "https://schema.org/PreOrder",
      price: entity.price ? entity.price.amount.toFixed(2) : "0",
      priceCurrency: entity.price?.currency ?? "USD",
    };
    return {
      ...base,
      applicationCategory: "ProductivityApplication",
      operatingSystem: "iOS, Android, Web",
      publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
      offers,
    };
  }
  if (schemaType === "Service") {
    return {
      ...base,
      provider: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    };
  }
  return base;
}

export const coreSoftwareJsonLd = entityJsonLd(
  VORINTHEX_GALAXY_REGISTRY.products.core,
);

/** FAQPage assembled from every indexable entity's AEO questions. */
export const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: getAllEntities()
    .filter((entity) => entity.seo.indexable && entity.visibility !== "hidden")
    .flatMap((entity) => entity.aeo?.questions ?? [])
    .map((qa) => ({
      "@type": "Question",
      name: qa.question,
      acceptedAnswer: { "@type": "Answer", text: qa.answer },
    })),
};

export function breadcrumbJsonLdForEntity(entity: GalaxyEntity) {
  const crumbs = getEntityBreadcrumbs(entity.id);
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
      ...crumbs
        .filter((crumb) => crumb.id !== "nexus.star")
        .map((crumb, index) => ({
          "@type": "ListItem",
          position: index + 2,
          name: crumb.name,
          item: absoluteUrl(crumb.routes.path),
        })),
    ],
  };
}

export function allIndexableEntities() {
  return getIndexableEntities();
}
