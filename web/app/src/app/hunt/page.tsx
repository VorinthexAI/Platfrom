import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
import { SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/site";

const HUNT_TITLE = "The Hunt";
const HUNT_DESCRIPTION =
  "The great collectors of the Vorinthex galaxy, ranked live by Intelligence Fragments.";

export const metadata: Metadata = {
  title: HUNT_TITLE,
  description: HUNT_DESCRIPTION,
  alternates: { canonical: "/hunt" },
  openGraph: {
    title: `${HUNT_TITLE} | ${SITE_NAME}`,
    description: HUNT_DESCRIPTION,
    url: absoluteUrl("/hunt"),
    siteName: SITE_NAME,
    type: "website",
    images: ["/social-cards/hunt/opengraph.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: `${HUNT_TITLE} | ${SITE_NAME}`,
    description: HUNT_DESCRIPTION,
    images: ["/social-cards/hunt/twitter.png"],
  },
};

/**
 * Lightweight JSON-LD: the hunt is a live leaderboard page, not a registry
 * entity, so it carries its own WebPage + breadcrumb rather than the
 * registry-driven entity/breadcrumb schema.
 */
const huntJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${HUNT_TITLE} | ${SITE_NAME}`,
    description: HUNT_DESCRIPTION,
    url: absoluteUrl("/hunt"),
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: SITE_URL },
  },
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: HUNT_TITLE,
        item: absoluteUrl("/hunt"),
      },
    ],
  },
];

/**
 * The galaxy hunt, anchored like a planet: this route (and the
 * hunt.vorinthex.com subdomain, via the proxy) dives straight into the
 * hunt asteroid on load.
 */
export default function HuntPage() {
  return (
    <>
      {huntJsonLd.map((entry, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(entry) }}
        />
      ))}
      <LandingPage initialCave="hunt" />
    </>
  );
}
