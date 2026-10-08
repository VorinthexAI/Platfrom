import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CorePage } from "@/components/core/CorePage";
import { PRODUCT_PILLARS } from "@/lib/discoverability";

test("renders the download action and Storage, Core, and Sparks pillars", () => {
  const html = renderToStaticMarkup(<CorePage />);

  expect(html).toContain("Download app");
  expect(html).toContain("Keep your work. Ask Core.");
  expect(html).not.toMatch(/pre-launch|in development|not purchasable/i);
  expect(html).not.toMatch(/Core Apps|Archive|Gallery|Compass|Ascend/);
  expect(html).not.toContain('href="/pricing"');
  expect(html).not.toContain('href="/about"');
  for (const pillar of PRODUCT_PILLARS) {
    expect(html).toContain(`id="${pillar.id}"`);
    expect(html).toContain(pillar.promise);
    for (const paragraph of pillar.details) expect(html).toContain(paragraph);
  }
});
