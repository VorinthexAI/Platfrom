import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CorePage } from "@/components/core/CorePage";
import { PricingPage } from "@/components/pricing/PricingPage";
import { CORE_CAPABILITIES } from "@/lib/discoverability";
import {
  NEWCOMER_FREE_SPARKS,
  SPARK_MONTHLY_PLANS,
  SPARK_TOP_UPS,
  formatSparkCount,
  formatUsd,
} from "@/lib/spark-pricing";

test("renders the download action and immersive Core app journey", () => {
  const html = renderToStaticMarkup(<CorePage />);

  expect(html).toContain("Download app");
  expect(html).not.toMatch(/pre-launch|in development|not purchasable/i);
  for (const capability of CORE_CAPABILITIES) {
    expect(html).toContain(`id="${capability.id}"`);
    for (const feature of capability.features) expect(html).toContain(feature);
  }
});

test("renders every pricing amount with a local-tax disclaimer", () => {
  const html = renderToStaticMarkup(<PricingPage />);

  expect(html).toContain(formatSparkCount(NEWCOMER_FREE_SPARKS));
  expect(html).toContain("Local taxes may be added where required.");
  expect(html).not.toMatch(/pre-launch|planned|not purchasable|unlimited/i);

  for (const plan of SPARK_MONTHLY_PLANS) {
    expect(html).toContain(plan.name);
    expect(html).toContain(formatSparkCount(plan.sparks));
    expect(html).toContain(formatUsd(plan.price));
  }
  for (const topUp of SPARK_TOP_UPS) {
    expect(html).toContain(formatSparkCount(topUp.sparks));
    expect(html).toContain(formatUsd(topUp.price));
  }
});
