import { describe, expect, test } from "bun:test";

import { COUNTRIES, findCountryAtCoordinates, parseCountryFeatureCollection } from "./globe-data";

describe("country GeoJSON", () => {
  test("parses the bundled Natural Earth collection", () => {
    expect(COUNTRIES.type).toBe("FeatureCollection");
    expect(COUNTRIES.features.length).toBeGreaterThan(220);
    expect(new Set(COUNTRIES.features.map(({ properties }) => properties.countryCode)).size).toBe(COUNTRIES.features.length);
  });

  test("rejects malformed collections", () => {
    expect(() => parseCountryFeatureCollection({ type: "FeatureCollection", features: [{}] })).toThrow();
  });

  test("finds countries by coordinates, including across the antimeridian", () => {
    expect(findCountryAtCoordinates(COUNTRIES, -6.05, 34.96)?.properties.countryCode).toBe("TZ");
    expect(findCountryAtCoordinates(COUNTRIES, -17.8, 178)?.properties.countryCode).toBe("FJ");
    expect(findCountryAtCoordinates(COUNTRIES, 1.35, 103.82)?.properties.countryCode).toBe("SG");
    expect(findCountryAtCoordinates(COUNTRIES, 0, -140)).toBeUndefined();
  });
});
