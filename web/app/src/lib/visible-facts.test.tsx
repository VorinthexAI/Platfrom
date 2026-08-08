import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { KnowledgeWorkspace } from "@/components/knowledge/KnowledgeWorkspace";
import { PricingPage } from "@/components/pricing/PricingPage";
import { CORE_CAPABILITIES } from "@/lib/discoverability";
import {
  NEWCOMER_FREE_SPARKS,
  SPARK_MONTHLY_PLANS,
  SPARK_TOP_UPS,
  formatSparkCount,
  formatUsd,
} from "@/lib/spark-pricing";

test("renders the knowledge workspace and complete Core app selector", () => {
  const capabilities = CORE_CAPABILITIES.map(({ id, name, icon, description }) => ({ id, name, icon, description }));
  const html = renderToStaticMarkup(<KnowledgeWorkspace capabilities={capabilities} />);

  expect(html).toContain("Start writing from here...");
  expect(html).toContain("Search by what you remember...");
  expect(html).toContain("Create or upload");
  expect(html).toContain(`<h1>${CORE_CAPABILITIES[0].name}</h1>`);
  for (const capability of CORE_CAPABILITIES) expect(html).toContain(capability.name);
  expect(html).toContain('aria-label="Previous app"');
  expect(html).toContain('aria-label="Next app"');
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
