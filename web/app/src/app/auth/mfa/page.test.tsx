import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isValidTotpUri } from "@vorinthex/shared/ui/components";

import { metadata } from "./page";
import { removeTokenFromVisibleUrl, transitionMfa, type MfaState } from "./MfaClient";

const challenge = "b".repeat(64);
const setupPayload = {
  setup_challenge_token_hash: challenge,
  otpauth_url: "otpauth://totp/Vorinthex:test",
  qr_code_data_url: "data:image/png;base64,abc",
  secret: "JBSWY3DPEHPK3PXP",
};

describe("founder MFA state machine", () => {
  test("accepts only TOTP authenticator deep links", () => {
    expect(isValidTotpUri("otpauth://totp/Vorinthex:test?secret=ABC")).toBe(true);
    expect(isValidTotpUri("https://example.com/totp")).toBe(false);
    expect(isValidTotpUri("otpauth://hotp/Vorinthex:test")).toBe(false);
  });

  test("removes only the challenge token from the visible URL", () => {
    const url = new URL(`https://vorinthex.com/auth/mfa?token_hash=${"a".repeat(64)}#secure`);
    expect(removeTokenFromVisibleUrl(url)).toBe("/auth/mfa#secure");
    expect(url.searchParams.has("token_hash")).toBe(false);
  });

  test("maps magic outcomes to authentication, setup start, verification, or retry", () => {
    const processing: MfaState = { kind: "processing" };
    expect(transitionMfa(processing, { type: "MAGIC", payload: { status: "authenticated" } })).toEqual({ kind: "authenticated" });
    expect(transitionMfa(processing, { type: "MAGIC", payload: { status: "totp_setup_required", totp_challenge_token_hash: challenge } })).toEqual({ kind: "setup-required", challenge });
    expect(transitionMfa(processing, { type: "MAGIC", payload: { status: "totp_required", totp_challenge_token_hash: challenge } })).toEqual({ kind: "verify", challenge });
    expect(transitionMfa(processing, { type: "MAGIC", payload: { status: "expired" } })).toEqual({ kind: "invalid" });
  });

  test("requires valid setup data and collects exactly the first six-digit code in memory", () => {
    const setup = transitionMfa({ kind: "processing" }, { type: "SETUP", payload: setupPayload });
    expect(setup).toMatchObject({ kind: "setup", setup: { challenge } });
    expect(transitionMfa(setup, { type: "FIRST_CODE", code: "12345" })).toEqual(setup);
    expect(transitionMfa(setup, { type: "FIRST_CODE", code: "123456" })).toMatchObject({ kind: "setup", firstCode: "123456" });
  });

  test("publishes noindex, noarchive, and nosnippet metadata", () => {
    expect(metadata.robots).toContain("noindex");
    expect(metadata.robots).toContain("noarchive");
    expect(metadata.robots).toContain("nosnippet");
  });

  test("scrubs before an explicit browser exchange and offers one reset request", () => {
    const source = readFileSync(new URL("./MfaClient.tsx", import.meta.url), "utf8");
    expect(source.indexOf("window.history.replaceState")).toBeLessThan(source.indexOf("const continueInBrowser"));
    expect(source).toContain("Continue in browser");
    expect(source).toContain("if (state.kind !== \"verify\" || resetSent) return");
    expect(source).toContain("Check your email for a recovery link. It expires in 15 minutes.");
  });
});
