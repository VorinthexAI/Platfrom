import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CorePage } from "@/components/core/CorePage";
import { PricingPage } from "@/components/pricing/PricingPage";
import {
  CORE_CAPABILITIES,
  PRICING_HERO_BODY,
  PRICING_HERO_HEADING,
} from "@/lib/discoverability";
import {
  NEWCOMER_FREE_SPARKS,
  REFERRAL_REWARDS,
  SPARK_SUBSCRIPTIONS,
  SPARK_TOP_UP,
  formatSparkCount,
  formatUsd,
} from "@/lib/spark-pricing";

test("renders the download action and immersive Core app journey", () => {
  const html = renderToStaticMarkup(<CorePage />);

  expect(html).toContain("Download app");
  expect(html).not.toMatch(/pre-launch|in development|not purchasable/i);
  for (const capability of CORE_CAPABILITIES) {
    expect(html).toContain(`id="${capability.id}"`);
    expect(html).toContain(capability.promise);
    for (const paragraph of capability.details) expect(html).toContain(paragraph);
  }
});

test("renders only active launch pricing and accurate referral rewards", () => {
  const html = renderToStaticMarkup(<PricingPage />);

  expect(html).toContain(PRICING_HERO_HEADING);
  expect(html).toContain(PRICING_HERO_BODY);
  expect(html).not.toMatch(/usage-based|pay only for what you use/i);
  expect(html).toContain(formatSparkCount(NEWCOMER_FREE_SPARKS));
  expect(html).toContain("exclude VAT and other local taxes");
  expect(html).toContain("Prepaid Sparks remain available after subscription cancellation");
  expect(html).toContain("balances never go below zero");
  expect(html).toContain("no debt or backcharges accrue");
  expect(html).toContain("hard-deleted after 90 consecutive unfunded days");
  expect(html).not.toMatch(/notice/i);
  expect(html).toContain("Best Value");
  expect(html).toContain("Currently discounted from regular");
  expect(html).toContain("Subscriptions coming soon");
  expect(html).toContain("Top-ups coming soon");
  expect(html).not.toMatch(/Moon|Comet|On-Demand|unlimited/i);

  for (const plan of SPARK_SUBSCRIPTIONS) {
    expect(html).toContain(plan.name);
    expect(html).toContain(formatSparkCount(plan.sparks));
    expect(html).toContain(formatUsd(plan.price));
  }
  expect(html).toContain(formatUsd(SPARK_SUBSCRIPTIONS[0].referencePrice));
  expect(html).toContain(formatSparkCount(SPARK_TOP_UP.sparks));
  expect(html).toContain(formatUsd(SPARK_TOP_UP.price));
  expect(html).toContain(`+${formatSparkCount(REFERRAL_REWARDS.signup)} Sparks`);
  expect(html).toContain(`+${formatSparkCount(REFERRAL_REWARDS.firstSubscriptionPurchase)} Sparks`);
  expect(html).toContain("When a new user signs up with your code.");
  expect(html).toContain("When that referred user first purchases a subscription.");
  expect(html).toContain("each reward stage one time per referred user");
});
