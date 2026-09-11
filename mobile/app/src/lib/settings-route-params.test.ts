import { expect, test } from "bun:test";

import { referralSettingsInitialState, settingsRouteParamsSchema } from "./settings-route-params";

test("accepts only complete referral settings deep-link params", () => {
  expect(referralSettingsInitialState({ sheet: "referral", mode: "share" })).toEqual({ sheet: "referral", referralMode: "share" });
  expect(referralSettingsInitialState({ sheet: "referral", mode: "redeem" })).toEqual({ sheet: "referral", referralMode: "redeem" });
  expect(referralSettingsInitialState({ sheet: "referral" })).toBeUndefined();
  expect(referralSettingsInitialState({ mode: "redeem" })).toBeUndefined();
  expect(referralSettingsInitialState({ sheet: "referral", mode: "other" })).toBeUndefined();
  expect(referralSettingsInitialState({ sheet: "referral", mode: "redeem", userKey: "forged" })).toBeUndefined();
});

test("allows settings without route params", () => {
  expect(settingsRouteParamsSchema.parse({})).toEqual({});
});
