import { expect, test } from "bun:test";

const source = await Bun.file(new URL("./email-client.ts", import.meta.url)).text();

test("uses bootstrap pricing and authoritative balance before opening inbox OAuth", () => {
  const costLookup = source.indexOf('sparkCosts.find(({ key }) => key === "inbox.sync")');
  const billingFetch = source.indexOf("await fetchBillingSummary()", costLookup);
  const insufficient = source.indexOf("billing.microSparkBalance < requiredMicroSparks", billingFetch);
  const oauthStart = source.indexOf('request("post", "/email/connect"', insufficient);
  expect(costLookup).toBeGreaterThan(-1);
  expect(billingFetch).toBeGreaterThan(costLookup);
  expect(insufficient).toBeGreaterThan(billingFetch);
  expect(oauthStart).toBeGreaterThan(insufficient);
  expect(source).toContain("observeDomainError");
  expect(source).toContain("INSUFFICIENT_BALANCE_CODE");
});
