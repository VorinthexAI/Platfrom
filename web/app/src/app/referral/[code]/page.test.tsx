import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ReferralFallbackPage, { isValidReferralCode, metadata } from "./page";

describe("referral acquisition fallback", () => {
  test("accepts only an exact uppercase 12-character hex code", () => {
    expect(isValidReferralCode("012345ABCDEF")).toBe(true);
    expect(isValidReferralCode("012345abcdef")).toBe(false);
    expect(isValidReferralCode("012345ABCDEFF")).toBe(false);
    expect(isValidReferralCode("012345ABCDEG")).toBe(false);
  });

  test("renders the fixed deep link and accurate referrer rewards", async () => {
    const page = await ReferralFallbackPage({ params: Promise.resolve({ code: "012345ABCDEF" }) });
    const html = renderToStaticMarkup(page);
    expect(html).toContain("vorinthexcore://referral/012345ABCDEF");
    expect(html).toContain("+50 Sparks");
    expect(html).toContain("+100 Sparks");
    expect(html).toContain("Your referrer earns this once");
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  test("rejects invalid route codes", async () => {
    expect(ReferralFallbackPage({ params: Promise.resolve({ code: "not-a-code" }) })).rejects.toThrow();
  });
});
