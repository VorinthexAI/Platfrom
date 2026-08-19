import { describe, expect, test } from "bun:test";

import {
  clampGlobeZoom,
  exceedsGlobeDragThreshold,
  latLonToVector,
  pointInPolygon,
  projectToTrackball,
  vectorToLatLon,
  type PolygonCoordinates,
} from "./globe-math";

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

describe("globe gestures", () => {
  test("projects the full pointer plane onto a unit trackball", () => {
    expect(projectToTrackball(0, 0)).toEqual({ x: 0, y: 0, z: 1 });
    expect(projectToTrackball(0.6, 0.8)).toEqual({ x: 0.6, y: 0.8, z: 0 });
    const outside = projectToTrackball(3, 4);
    expect(outside.x).toBeCloseTo(0.6, 10);
    expect(outside.y).toBeCloseTo(0.8, 10);
    expect(outside.z).toBe(0);
    expect(Math.hypot(outside.x, outside.y, outside.z)).toBeCloseTo(1, 10);
  });

  test("distinguishes taps from drags at the configured screen threshold", () => {
    expect(exceedsGlobeDragThreshold(10, 10, 16, 18, 10)).toBe(false);
    expect(exceedsGlobeDragThreshold(10, 10, 17, 18, 10)).toBe(true);
  });

  test("bounds wheel and pinch camera distances", () => {
    expect(clampGlobeZoom(1, 2.15, 4.1)).toBe(2.15);
    expect(clampGlobeZoom(3, 2.15, 4.1)).toBe(3);
    expect(clampGlobeZoom(5, 2.15, 4.1)).toBe(4.1);
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
