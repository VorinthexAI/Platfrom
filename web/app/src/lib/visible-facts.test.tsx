import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CorePage } from "@/components/core/CorePage";
import { PricingPage } from "@/components/pricing/PricingPage";
import { CORE_CAPABILITIES, CORE_FAQ } from "@/lib/discoverability";
import {
  NEWCOMER_FREE_SPARKS,
  SPARK_MONTHLY_PLANS,
  SPARK_TOP_UPS,
  formatSparkCount,
  formatUsd,
} from "@/lib/spark-pricing";

test("renders launch status, exact FAQ, and the immersive capability journey", () => {
  const html = renderToStaticMarkup(<CorePage />);

  expect(html).toContain("Pre-launch. Downloads and purchases are not currently available.");
  for (const { question, answer } of CORE_FAQ) {
    expect(html).toContain(question);
    expect(html).toContain(answer.replace(/'/g, "&#x27;"));
  }
  for (const capability of CORE_CAPABILITIES) {
    expect(html).toContain(`id="${capability.id}"`);
    for (const feature of capability.features) expect(html).toContain(feature);
  }
});

test("renders every approved planned pricing amount as unavailable USD", () => {
  const html = renderToStaticMarkup(<PricingPage />);

  expect(html).toContain(formatSparkCount(NEWCOMER_FREE_SPARKS));
  expect(html).toContain("Planned USD preview. Not purchasable.");
  expect(html).not.toMatch(/most popular|unlimited/i);

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
