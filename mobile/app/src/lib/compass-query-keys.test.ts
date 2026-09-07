import { expect, test } from "bun:test";

import { compassQueryKeys } from "./compass-query-keys";

const context = { teamKey: "team-key", scopeKey: "scope-key" };

test("includes normalized text and sorted tags in saved travel query identities", () => {
  expect(compassQueryKeys.placeSearch(context, " Northern Lights ", ["winter", "aurora"])).toEqual([
    "compass", "team-key", "scope-key", "place-searches", "northern lights", ["aurora", "winter"],
  ]);
  expect(compassQueryKeys.tripSearch(context, "", ["winter", "aurora"])).toEqual([
    "compass", "team-key", "scope-key", "trip-searches", "", ["aurora", "winter"],
  ]);
});
