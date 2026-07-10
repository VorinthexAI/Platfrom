import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import { SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/site";

const PRICING_TITLE = "Pricing";
const PRICING_DESCRIPTION =
  "Vorinthex AI pricing: Spark plans from $19.99/month, on-demand usage, and instant one-time top-up packs.";

export const metadata: Metadata = {
  title: `${PRICING_TITLE} | ${SITE_NAME}`,
  description: PRICING_DESCRIPTION,
  alternates: { canonical: "/pricing" },
};

const { summary, plans, onDemand, topUps } =
  VORINTHEX_GALAXY_REGISTRY.sparkPricing;

/**
 * Lightweight JSON-LD: pricing is not a registry entity, so it carries
 * its own WebPage + breadcrumb plus one Offer per Spark plan (real
 * prices, USD) rather than the registry-driven entity schema.
 */
const pricingJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${PRICING_TITLE} | ${SITE_NAME}`,
    description: PRICING_DESCRIPTION,
    url: absoluteUrl("/pricing"),
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
        name: PRICING_TITLE,
        item: absoluteUrl("/pricing"),
      },
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "OfferCatalog",
    name: "Vorinthex AI Spark Plans",
    url: absoluteUrl("/pricing"),
    itemListElement: plans.map((plan) => ({
      "@type": "Offer",
      name: `${plan.name} Plan`,
      description: `${plan.description} Includes ${plan.monthlySparks.toLocaleString("en-US")} Sparks per month.`,
      price: plan.priceUsd,
      priceCurrency: "USD",
      url: absoluteUrl("/pricing"),
    })),
  },
];

/**
 * Spark pricing is read inside an asteroid — the Exchange. The copy stays
 * server-rendered (visually hidden) for crawlers, straight from the
 * registry's `sparkPricing` source of truth.
 */
export default function PricingPage() {
  return (
    <>
      {pricingJsonLd.map((entry, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(entry) }}
        />
      ))}
      <LandingPage initialCave="pricing" />
      <article className="sr-only">
        <h1>{PRICING_TITLE}</h1>
        <p>{summary}</p>
        <h2>Plans</h2>
        <ul>
          {plans.map((plan) => (
            <li key={plan.id}>
              {plan.name} — ${plan.priceUsd} per month, includes{" "}
              {plan.monthlySparks.toLocaleString("en-US")} Sparks per month.{" "}
              {plan.description}
            </li>
          ))}
        </ul>
        <p>Plans are billed monthly and carry the lowest cost per Spark.</p>
        <h2>{onDemand.name}</h2>
        <p>
          {onDemand.description} Billed monthly. {onDemand.costTier} than
          plans.
        </p>
        <h2>{topUps.name}</h2>
        <p>
          {topUps.description} One-time purchase, credited instantly.{" "}
          {topUps.costTier} of the three options.
        </p>
      </article>
    </>
  );
}
