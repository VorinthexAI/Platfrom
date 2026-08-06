import {
  SPARK_MONTHLY_PLANS,
  SPARK_ON_DEMAND,
  SPARK_TOP_UPS,
  formatSparkCount,
  formatUsd,
} from "@/lib/spark-pricing";

export const dynamic = "force-static";

export function GET() {
  return new Response(`# Vorinthex AI

> Vorinthex Core is one private personal AI for the context that matters to you.

## Vorinthex Core

Core is a mobile app for iOS and Android. It remembers, understands, and connects knowledge, memories, communication, discovery, and personal growth.

## Core Capabilities

- Archive captures, organizes, searches, and connects knowledge.
- Gallery organizes visual memory and understands its context.
- Signal filters communication noise and keeps important conversations connected.
- Compass maps knowledge, places, memories, and plans.
- Ascend supports goals, habits, clarity, and personal growth.

Core is designed around one intelligence, privacy by design, and personal context.

## Pricing

The following Sparks pricing is planned. Purchases are not yet available.

Planned monthly options:

${SPARK_MONTHLY_PLANS.map((plan) => `- ${plan.name}: ${formatUsd(plan.price)} per month for ${formatSparkCount(plan.sparks)} monthly Sparks.`).join("\n")}

Planned one-time top-ups:

${SPARK_TOP_UPS.map((topUp) => `- ${formatSparkCount(topUp.sparks)} Sparks: ${formatUsd(topUp.price)}.`).join("\n")}

${SPARK_ON_DEMAND.name} provides ${SPARK_ON_DEMAND.allowance.toLowerCase()} and requires the ${SPARK_ON_DEMAND.requiresPlan} plan.

## About Vorinthex AI

Vorinthex AI is an AI-native software company focused on making personal intelligence practical, private, and deeply useful. Core connects context that would otherwise remain scattered across disconnected tools.

## Links

- [Get the app](https://vorinthex.com/#download)
- [Sparks Pricing](https://vorinthex.com/pricing)
- [About Vorinthex AI](https://vorinthex.com/about)
- [Privacy](https://vorinthex.com/privacy)
- [Terms](https://vorinthex.com/terms)
- [Contact](https://vorinthex.com/contact)
`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
