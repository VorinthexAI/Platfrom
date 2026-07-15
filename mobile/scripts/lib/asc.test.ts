import { describe, expect, spyOn, test } from "bun:test";

import { buildAppAvailabilityPayload } from "./asc";

describe("buildAppAvailabilityPayload", () => {
  test("uses only configured territories in both full-linkage locations", () => {
    const payload = buildAppAvailabilityPayload(
      "app-id",
      ["USA", "CAN", "SWE"],
      ["NER", "USA", "MWI", "CAN", "SWE"],
    ) as {
      data: {
        relationships: { territoryAvailabilities: { data: Array<{ id: string }> } };
      };
      included: Array<{
        id: string;
        relationships: { territory: { data: { id: string } } };
      }>;
    };

    expect(payload.data.relationships.territoryAvailabilities.data.map(({ id }) => id)).toEqual([
      "${USA}",
      "${CAN}",
      "${SWE}",
    ]);
    expect(payload.included.map(({ id }) => id)).toEqual(["${USA}", "${CAN}", "${SWE}"]);
    expect(
      payload.included.map(({ relationships }) => relationships.territory.data.id),
    ).toEqual(["USA", "CAN", "SWE"]);
    expect(JSON.stringify(payload)).not.toContain("NER");
    expect(JSON.stringify(payload)).not.toContain("MWI");
  });

  test("warns and continues when Apple omits a configured territory", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    const payload = buildAppAvailabilityPayload("app-id", ["USA", "LIE"], ["USA"]) as {
      included: Array<{ relationships: { territory: { data: { id: string } } } }>;
    };

    expect(payload.included.map((item) => item.relationships.territory.data.id)).toEqual(["USA"]);
    expect(warn).toHaveBeenCalledWith("Skipping unavailable Apple territories: LIE");
    warn.mockRestore();
  });

  test("rejects a payload when Apple returns none of the configured territories", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    expect(() => buildAppAvailabilityPayload("app-id", ["LIE"], ["USA"])).toThrow(
      "None of the configured Apple territories are currently available.",
    );
    warn.mockRestore();
  });
});
