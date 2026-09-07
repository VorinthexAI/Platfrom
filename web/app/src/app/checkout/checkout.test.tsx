import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import CheckoutPage, { metadata as checkoutMetadata } from "./page";
import CheckoutSuccessPage from "./success/page";
import CheckoutErrorPage from "./error/page";
import { metadata as privateMetadata } from "./layout";
import { appReturnUrl } from "@/components/private/AppReturnFallback";
import { PRICING_HERO_BODY } from "@/lib/discoverability";
import { captureHandoffFragment } from "./CheckoutHandoff";

describe("private checkout surfaces", () => {
  test("marks the complete checkout subtree private", () => {
    expect(privateMetadata.robots).toEqual({ index: false, follow: false, nocache: true, noarchive: true, nosnippet: true });
    expect(checkoutMetadata.title).toBe("Secure checkout");
  });

  test("renders a neutral shell before the fragment is available", () => {
    const html = renderToStaticMarkup(<CheckoutPage />);
    expect(html).toContain("Preparing your selection");
    expect(html).toContain(PRICING_HERO_BODY);
    expect(html).not.toMatch(/usage-based|pay only for what you use/i);
    expect(html).not.toContain("vch_");
  });

  test("removes the fragment before returning a valid token", () => {
    const events: string[] = [];
    const location = { hash: `#handoff=vch_${"A".repeat(43)}`, pathname: "/checkout", search: "" } as Location;
    const history = { replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => events.push(String(url)) } as unknown as History;
    expect(captureHandoffFragment(location, history)).toBe(`vch_${"A".repeat(43)}`);
    expect(events).toEqual(["/checkout"]);
  });

  test("does not accept a token from query-like or compound fragments", () => {
    const history = { replaceState: () => undefined } as unknown as History;
    expect(captureHandoffFragment({ hash: `#other=x&handoff=vch_${"A".repeat(43)}`, pathname: "/checkout", search: "" } as Location, history)).toBeUndefined();
    expect(captureHandoffFragment({ hash: `#handoff=vch_${"A".repeat(43)}&extra=x`, pathname: "/checkout", search: "" } as Location, history)).toBeUndefined();
  });

  test("renders fixed success and retry copy with fixed deep links", () => {
    const success = renderToStaticMarkup(<CheckoutSuccessPage />);
    const error = renderToStaticMarkup(<CheckoutErrorPage />);
    expect(success).toContain("webhook is authoritative");
    expect(error).toContain("Nothing to worry about");
    expect(appReturnUrl("success")).toBe("vorinthexcore://checkout/success");
    expect(appReturnUrl("error")).toBe("vorinthexcore://checkout/error");
  });
});
