import { describe, expect, test } from "bun:test";

import { latLonToVector, pointInPolygon, vectorToLatLon, type PolygonCoordinates } from "./globe-math";

describe("globe coordinates", () => {
  test("converts cardinal coordinates to globe vectors", () => {
    expect(latLonToVector(0, 0)).toEqual({ x: 0, y: 0, z: 1 });
    const north = latLonToVector(90, 40, 2);
    expect(north.y).toBeCloseTo(2, 10);
    expect(north.x).toBeCloseTo(0, 10);
    expect(north.z).toBeCloseTo(0, 10);
  });

  test("round trips latitude and longitude", () => {
    const result = vectorToLatLon(latLonToVector(-33.8688, 151.2093, 4));
    expect(result.latitude).toBeCloseTo(-33.8688, 8);
    expect(result.longitude).toBeCloseTo(151.2093, 8);
  });
});

describe("point in polygon", () => {
  test("handles exterior rings and holes", () => {
    const polygon: PolygonCoordinates = [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
    ];
    expect(pointInPolygon(1, 1, polygon)).toBe(true);
    expect(pointInPolygon(5, 5, polygon)).toBe(false);
    expect(pointInPolygon(12, 5, polygon)).toBe(false);
  });

  test("unwraps polygons crossing the antimeridian around the query", () => {
    const polygon: PolygonCoordinates = [[
      [170, -10], [-170, -10], [-170, 10], [170, 10], [170, -10],
    ]];
    expect(pointInPolygon(179, 0, polygon)).toBe(true);
    expect(pointInPolygon(-179, 0, polygon)).toBe(true);
    expect(pointInPolygon(0, 0, polygon)).toBe(false);
  });
});
