import {
  NEWCOMER_FREE_SPARKS,
  SPARK_MONTHLY_PLANS,
  formatSparkCount,
  formatUsd,
} from "@/lib/spark-pricing";

export const dynamic = "force-static";

export function GET() {
  return new Response(`# Vorinthex AI

> Vorinthex Core is your private personal AI, available for iOS and Android.

## Core

- [Vorinthex Core](https://vorinthex.com): Connect knowledge, memories, communication, discovery, and growth in one personal AI.
- [Sparks Pricing](https://vorinthex.com/pricing): Newcomers receive ${formatSparkCount(NEWCOMER_FREE_SPARKS)} free Sparks. Monthly plans start with ${SPARK_MONTHLY_PLANS[0].name} at ${formatUsd(SPARK_MONTHLY_PLANS[0].price)} for ${formatSparkCount(SPARK_MONTHLY_PLANS[0].sparks)} Sparks.

## Company

- [About](https://vorinthex.com/about): Vorinthex AI is an AI-native software company focused on personal intelligence.
- [Privacy](https://vorinthex.com/privacy): Privacy and data controls.
- [Contact](https://vorinthex.com/contact): Contact Vorinthex AI.
`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
