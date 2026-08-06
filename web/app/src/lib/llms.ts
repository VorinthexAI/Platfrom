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

function buildPlannedPricingText(): string {
  const { newcomerAllocation, monthlyPlans, onDemand, topUps } =
    PRODUCT_FACTS.pricing;

  return `All pricing and allocations below are planned. Amounts are in USD, and none are currently purchasable.

- Planned newcomer allocation: ${formatSparkCount(newcomerAllocation)} Sparks.
- Planned monthly options:
${monthlyPlans.map((plan) => `  - ${plan.name}: ${formatUsd(plan.price)} per month for ${formatSparkCount(plan.sparks)} Sparks.`).join("\n")}
- Planned one-time top-ups:
${topUps.map((topUp) => `  - ${formatSparkCount(topUp.sparks)} Sparks for ${formatUsd(topUp.price)}.`).join("\n")}
- ${onDemand.name}: ${onDemand.description}; planned to require ${onDemand.requiresPlan}. No allowance beyond the planned overflow is specified.`;
}

export function buildLlmsText(): string {
  return `# Vorinthex AI

> Vorinthex Core is a pre-launch personal AI planned for iOS and Android. Downloads and purchases are not currently available.

Last reviewed: ${CONTENT_LAST_REVIEWED}

## Product

- [Vorinthex Core](${CANONICAL_ORIGIN}): ${PUBLIC_DISCOVERABILITY_REGISTRY["/"].summary}
- [Planned Sparks pricing](${canonicalUrl("/pricing")}): ${PRODUCT_FACTS.sparks}

${buildPlannedPricingText()}

## Company and policies

- [About](${canonicalUrl("/about")}): ${PUBLIC_DISCOVERABILITY_REGISTRY["/about"].summary}
- [Privacy](${canonicalUrl("/privacy")}): ${PUBLIC_DISCOVERABILITY_REGISTRY["/privacy"].summary}
- [Terms](${canonicalUrl("/terms")}): ${PUBLIC_DISCOVERABILITY_REGISTRY["/terms"].summary}
- [Contact](${canonicalUrl("/contact")}): Email ${CONTACT_EMAIL}.
`;
}

export function buildLlmsFullText(): string {
  return `# Vorinthex AI

> Vorinthex AI is developing Core, a personal AI planned for iOS and Android. The product is pre-launch; downloads and purchases are not currently available.

Last reviewed: ${CONTENT_LAST_REVIEWED}

## Current status

${PRODUCT_FACTS.name} is ${PRODUCT_FACTS.status.toLowerCase()}. ${PRODUCT_FACTS.availability} ${PRODUCT_FACTS.privacy}

## Planned capabilities

${PRODUCT_FACTS.capabilities.map(({ name, description }) => `- ${name}: ${description}`).join("\n")}

## Sparks and pricing

${PRODUCT_FACTS.sparks}

${buildPlannedPricingText()}

## Frequently asked questions

${PRODUCT_FACTS.faq.map(({ question, answer }) => `### ${question}\n\n${answer}`).join("\n\n")}

## Canonical evidence links

${evidenceLinks}

## Contact

- [Contact Vorinthex AI](${canonicalUrl("/contact")}): Email ${CONTACT_EMAIL}.
`;
}
