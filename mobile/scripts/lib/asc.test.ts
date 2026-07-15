import { describe, expect, test } from "bun:test";

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

  test("rejects configured territory codes Apple does not return", () => {
    expect(() => buildAppAvailabilityPayload("app-id", ["USA", "SWE"], ["USA"])).toThrow(
      "Configured Apple territories are unavailable: SWE",
    );
  });
});
