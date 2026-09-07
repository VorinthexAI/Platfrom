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
  const { newcomerAllocation, referrals, subscriptions, topUp, webPurchasesAvailable } =
    PRODUCT_FACTS.pricing;

  return `Prices are shown in USD and exclude VAT and other local taxes. Polar calculates and adds applicable tax at checkout.

- Newcomer allocation: ${formatSparkCount(newcomerAllocation)} Sparks.
- Active subscription options:
${subscriptions.map((plan) => `  - ${plan.name}: ${formatUsd(plan.price)} per ${plan.cadence} for ${formatSparkCount(plan.sparks)} Sparks per billing ${plan.cadence}${"referencePrice" in plan ? `; currently discounted from the regular ${formatUsd(plan.referencePrice)} monthly price` : ""}.`).join("\n")}
- One-time top-up: ${formatSparkCount(topUp.sparks)} Sparks for ${formatUsd(topUp.price)}.
- Referral rewards for the referrer: ${formatSparkCount(referrals.signup)} Sparks when a new user signs up with the referrer's code, then ${formatSparkCount(referrals.firstSubscriptionPurchase)} Sparks when that referred user first purchases a subscription. Each stage is awarded once per referred user.
- Public website purchases available: ${webPurchasesAvailable ? "yes" : "no; coming soon"}.`;
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

${PRODUCT_FACTS.capabilities.map(({ name, description, details }) => `- ${name}: ${description} ${details.join(" ")}`).join("\n")}

## Sparks and pricing

${PRODUCT_FACTS.sparks}

${buildPricingText()}

## Canonical evidence links

${evidenceLinks}

## Contact

- [Contact Vorinthex AI](${canonicalUrl("/contact")}): Email ${CONTACT_EMAIL}.
`;
}
