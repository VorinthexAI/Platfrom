import { describe, expect, test } from "bun:test";

import * as THREE from "three";

import { COUNTRIES, createCountryFillGeometry, findCountryAtCoordinates, parseCountryFeatureCollection, type CountryFeature } from "./globe-data";

function testFeature(coordinates: CountryFeature["geometry"]["coordinates"]): CountryFeature {
  return {
    type: "Feature",
    properties: { name: "Test", countryCode: "XX", continent: "Test", longitude: 180, latitude: 0 },
    geometry: { type: "Polygon", coordinates: coordinates as never },
  };
}

describe("country GeoJSON", () => {
  test("parses the bundled Natural Earth collection", () => {
    expect(COUNTRIES.type).toBe("FeatureCollection");
    expect(COUNTRIES.features.length).toBeGreaterThan(220);
    expect(new Set(COUNTRIES.features.map(({ properties }) => properties.countryCode)).size).toBe(COUNTRIES.features.length);
  });

  test("uses concise audited display names for formal country labels", () => {
    const names = new Map(COUNTRIES.features.map(({ properties }) => [properties.countryCode, properties.name]));
    expect(Object.fromEntries([...names].filter(([code]) => ["BS", "CI", "CN", "CZ", "FM", "GM", "TL", "US"].includes(code)))).toEqual({
      BS: "Bahamas", CI: "Côte d’Ivoire", CN: "China", CZ: "Czechia", FM: "Micronesia", GM: "Gambia", TL: "Timor-Leste", US: "United States",
    });
    expect([...names.values()]).not.toContain("People's Republic of China");
    expect(new Set(names.values()).size).toBe(names.size);
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

  test("cleans closed rings and tessellates every fill triangle onto the sphere", () => {
    const radius = 2;
    const geometry = createCountryFillGeometry(testFeature([[[-30, -20], [30, -20], [30, 20], [-30, 20], [-30, -20], [-30, -20]]]), radius);
    const positions = geometry.getAttribute("position");
    expect(positions.count).toBeGreaterThan(6);
    expect(positions.count % 3).toBe(0);

    for (let index = 0; index < positions.count; index += 1) {
      expect(new THREE.Vector3().fromBufferAttribute(positions, index).length()).toBeCloseTo(radius, 5);
    }
    for (let index = 0; index < positions.count; index += 3) {
      const points = [0, 1, 2].map((offset) => new THREE.Vector3().fromBufferAttribute(positions, index + offset));
      expect(Math.max(points[0]!.angleTo(points[1]!), points[1]!.angleTo(points[2]!), points[2]!.angleTo(points[0]!))).toBeLessThanOrEqual(THREE.MathUtils.degToRad(2.01));
      expect(points[0]!.clone().add(points[1]!).add(points[2]!).divideScalar(3).length()).toBeGreaterThan(radius * 0.9997);
    }
  });

  test("keeps antimeridian polygons local and excludes cleaned holes", () => {
    const geometry = createCountryFillGeometry(testFeature([[
      [170, -12], [-170, -12], [-170, 12], [170, 12], [170, -12],
    ], [
      [176, -5], [184, -5], [184, 5], [176, 5], [176, -5], [176, -5],
    ]]));
    const positions = geometry.getAttribute("position");
    expect(positions.count).toBeGreaterThan(0);

    for (let index = 0; index < positions.count; index += 3) {
      const center = new THREE.Vector3();
      for (let offset = 0; offset < 3; offset += 1) center.add(new THREE.Vector3().fromBufferAttribute(positions, index + offset));
      center.normalize();
      const longitude = THREE.MathUtils.radToDeg(Math.atan2(center.x, center.z));
      const latitude = THREE.MathUtils.radToDeg(Math.asin(center.y));
      expect(Math.abs(longitude)).toBeGreaterThan(169);
      expect(Math.abs(longitude) < 176 || Math.abs(latitude) >= 5).toBe(true);
    }
  });
});
