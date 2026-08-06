import {
  CANONICAL_ORIGIN,
  CONTACT_EMAIL,
  CONTENT_LAST_REVIEWED,
  PRODUCT_FACTS,
  PUBLIC_DISCOVERABILITY_REGISTRY,
  PUBLIC_ROUTES,
  canonicalUrl,
} from "@/lib/discoverability";
import { formatSparkCount, formatUsd } from "@/lib/spark-pricing";

const evidenceLinks = PUBLIC_ROUTES.map(
  ({ path, title, summary }) => `- [${title}](${canonicalUrl(path)}): ${summary}`,
).join("\n");

function buildPricingText(): string {
  const { newcomerAllocation, monthlyPlans, onDemand, topUps } =
    PRODUCT_FACTS.pricing;

  return `Prices are shown in USD. Local taxes may be added where required.

- Newcomer allocation: ${formatSparkCount(newcomerAllocation)} Sparks.
- Monthly options:
${monthlyPlans.map((plan) => `  - ${plan.name}: ${formatUsd(plan.price)} per month for ${formatSparkCount(plan.sparks)} Sparks.`).join("\n")}
- One-time top-ups:
${topUps.map((topUp) => `  - ${formatSparkCount(topUp.sparks)} Sparks for ${formatUsd(topUp.price)}.`).join("\n")}
- ${onDemand.name}: ${onDemand.description}; requires ${onDemand.requiresPlan}.`;
}

export function buildLlmsText(): string {
  return `# Vorinthex AI

> Vorinthex Core is a personal AI for iOS and Android that connects knowledge, memories, communication, discovery, and goals.

Last reviewed: ${CONTENT_LAST_REVIEWED}

## Product

- [Vorinthex Core](${CANONICAL_ORIGIN}): ${PUBLIC_DISCOVERABILITY_REGISTRY["/"].summary}
- [Sparks pricing](${canonicalUrl("/pricing")}): ${PRODUCT_FACTS.sparks}

${buildPricingText()}

## Company and policies

- [About](${canonicalUrl("/about")}): ${PUBLIC_DISCOVERABILITY_REGISTRY["/about"].summary}
- [Privacy](${canonicalUrl("/privacy")}): ${PUBLIC_DISCOVERABILITY_REGISTRY["/privacy"].summary}
- [Terms](${canonicalUrl("/terms")}): ${PUBLIC_DISCOVERABILITY_REGISTRY["/terms"].summary}
- [Contact](${canonicalUrl("/contact")}): Email ${CONTACT_EMAIL}.
`;
}

export function buildLlmsFullText(): string {
  return `# Vorinthex AI

> Vorinthex AI builds Core, a personal AI for iOS and Android that connects the context that matters to you.

Last reviewed: ${CONTENT_LAST_REVIEWED}

## Product

${PRODUCT_FACTS.name} is ${PRODUCT_FACTS.status.toLowerCase()}. ${PRODUCT_FACTS.availability} ${PRODUCT_FACTS.privacy}

## Core apps

${PRODUCT_FACTS.capabilities.map(({ name, description }) => `- ${name}: ${description}`).join("\n")}

## Sparks and pricing

${PRODUCT_FACTS.sparks}

${buildPricingText()}

## Canonical evidence links

${evidenceLinks}

## Contact

- [Contact Vorinthex AI](${canonicalUrl("/contact")}): Email ${CONTACT_EMAIL}.
`;
}
