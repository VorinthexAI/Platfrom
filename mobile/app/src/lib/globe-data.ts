import * as THREE from "three";

import countriesJson from "@/data/countries-110m.json";
import countryNameOverridesJson from "@/data/country-name-overrides.json";
import smallCountriesJson from "@/data/countries-small.json";
import {
  latLonToVector,
  pointInMultiPolygon,
  pointInPolygon,
  type MultiPolygonCoordinates,
  type PolygonCoordinates,
} from "./globe-math";

export type CountryProperties = Readonly<{
  name: string;
  countryCode: string;
  continent: string;
  longitude: number;
  latitude: number;
}>;

export type CountryGeometry =
  | Readonly<{ type: "Polygon"; coordinates: PolygonCoordinates }>
  | Readonly<{ type: "MultiPolygon"; coordinates: MultiPolygonCoordinates }>;

export type CountryFeature = Readonly<{
  type: "Feature";
  properties: CountryProperties;
  geometry: CountryGeometry;
}>;

export type CountryFeatureCollection = Readonly<{
  type: "FeatureCollection";
  features: readonly CountryFeature[];
}>;

function isPosition(value: unknown): value is readonly [number, number] {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number";
}

function isRing(value: unknown): value is PolygonCoordinates[number] {
  return Array.isArray(value) && value.length >= 3 && value.every(isPosition);
}

function isPolygon(value: unknown): value is PolygonCoordinates {
  return Array.isArray(value) && value.length > 0 && value.every(isRing);
}

export function parseCountryFeatureCollection(value: unknown): CountryFeatureCollection {
  if (!value || typeof value !== "object") throw new Error("Country data must be an object");
  const collection = value as { type?: unknown; features?: unknown };
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error("Country data must be a GeoJSON FeatureCollection");
  }

  for (const featureValue of collection.features) {
    if (!featureValue || typeof featureValue !== "object") throw new Error("Invalid country feature");
    const feature = featureValue as { type?: unknown; properties?: unknown; geometry?: unknown };
    const properties = feature.properties as Partial<CountryProperties> | null;
    const geometry = feature.geometry as { type?: unknown; coordinates?: unknown } | null;
    const validProperties = properties
      && typeof properties.name === "string"
      && typeof properties.countryCode === "string"
      && typeof properties.continent === "string"
      && typeof properties.longitude === "number"
      && typeof properties.latitude === "number";
    const validGeometry = geometry?.type === "Polygon"
      ? isPolygon(geometry.coordinates)
      : geometry?.type === "MultiPolygon"
        && Array.isArray(geometry.coordinates)
        && geometry.coordinates.length > 0
        && geometry.coordinates.every(isPolygon);

    if (feature.type !== "Feature" || !validProperties || !validGeometry) {
      throw new Error("Invalid country GeoJSON feature");
    }
  }

  return value as CountryFeatureCollection;
}

export const COUNTRIES = parseCountryFeatureCollection({
  type: "FeatureCollection",
  // Small-state polygons take precedence where coarse 110m neighbors overlap.
  features: [...smallCountriesJson.features, ...countriesJson.features].map((feature) => ({
    ...feature,
    properties: {
      ...feature.properties,
      name: (countryNameOverridesJson as Record<string, string>)[feature.properties.countryCode] ?? feature.properties.name,
    },
  })),
});

export function findCountryAtCoordinates(
  collection: CountryFeatureCollection,
  latitude: number,
  longitude: number,
): CountryFeature | undefined {
  if (latitude < -90 || latitude > 90 || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;

  return collection.features.find((feature) => feature.geometry.type === "Polygon"
    ? pointInPolygon(longitude, latitude, feature.geometry.coordinates)
    : pointInMultiPolygon(longitude, latitude, feature.geometry.coordinates));
}

export function createCountryBoundaryGeometry(
  collection: CountryFeatureCollection = COUNTRIES,
  radius = 1.021,
): THREE.BufferGeometry {
  const positions: number[] = [];

  const appendPolygon = (polygon: PolygonCoordinates) => {
    for (const ring of polygon) {
      for (let index = 1; index < ring.length; index += 1) {
        const start = ring[index - 1];
        const end = ring[index];
        if (!start || !end) continue;
        const a = latLonToVector(start[1], start[0], radius);
        const b = latLonToVector(end[1], end[0], radius);
        const startVector = new THREE.Vector3(a.x, a.y, a.z);
        const endVector = new THREE.Vector3(b.x, b.y, b.z);
        const steps = Math.max(1, Math.ceil(startVector.angleTo(endVector) / THREE.MathUtils.degToRad(2)));
        let previous = startVector;
        for (let step = 1; step <= steps; step += 1) {
          const next = startVector.clone().lerp(endVector, step / steps).normalize().multiplyScalar(radius);
          positions.push(previous.x, previous.y, previous.z, next.x, next.y, next.z);
          previous = next;
        }
      }
    }
  };

  for (const feature of collection.features) {
    if (feature.geometry.type === "Polygon") appendPolygon(feature.geometry.coordinates);
    else feature.geometry.coordinates.forEach(appendPolygon);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createCountryFillGeometry(feature: CountryFeature, radius = 1.018): THREE.BufferGeometry {
  const positions: number[] = [];
  const maximumEdgeAngle = THREE.MathUtils.degToRad(2);
  const midpoint = new THREE.Vector3();

  const appendSphericalTriangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, depth = 0) => {
    const angles = [a.angleTo(b), b.angleTo(c), c.angleTo(a)] as const;
    const longestEdge = angles.indexOf(Math.max(...angles));
    if (angles[longestEdge]! <= maximumEdgeAngle || depth >= 16) {
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      return;
    }

    if (longestEdge === 0) {
      midpoint.copy(a).add(b).normalize().multiplyScalar(radius);
      const ab = midpoint.clone();
      appendSphericalTriangle(a, ab, c, depth + 1);
      appendSphericalTriangle(ab, b, c, depth + 1);
    } else if (longestEdge === 1) {
      midpoint.copy(b).add(c).normalize().multiplyScalar(radius);
      const bc = midpoint.clone();
      appendSphericalTriangle(a, b, bc, depth + 1);
      appendSphericalTriangle(a, bc, c, depth + 1);
    } else {
      midpoint.copy(c).add(a).normalize().multiplyScalar(radius);
      const ca = midpoint.clone();
      appendSphericalTriangle(a, b, ca, depth + 1);
      appendSphericalTriangle(ca, b, c, depth + 1);
    }
  };

  const cleanAndUnwrapRing = (
    ring: PolygonCoordinates[number],
    referenceLongitude?: number,
  ): Array<readonly [number, number]> => {
    const cleaned: Array<readonly [number, number]> = [];
    for (const coordinate of ring) {
      if (!Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) continue;
      const previous = cleaned.at(-1);
      const longitude = previous
        ? previous[0] + ((coordinate[0] - previous[0] + 540) % 360) - 180
        : coordinate[0];
      if (!previous || Math.abs(longitude - previous[0]) > 1e-9 || Math.abs(coordinate[1] - previous[1]) > 1e-9) {
        cleaned.push([longitude, coordinate[1]]);
      }
    }

    const first = cleaned[0];
    const last = cleaned.at(-1);
    if (first && last && Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) cleaned.pop();
    if (cleaned.length < 3 || referenceLongitude === undefined) return cleaned;

    const averageLongitude = cleaned.reduce((sum, coordinate) => sum + coordinate[0], 0) / cleaned.length;
    const longitudeShift = Math.round((referenceLongitude - averageLongitude) / 360) * 360;
    return longitudeShift === 0 ? cleaned : cleaned.map(([longitude, latitude]) => [longitude + longitudeShift, latitude]);
  };

  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const polygon of polygons) {
    const outer = polygon[0] ? cleanAndUnwrapRing(polygon[0]) : [];
    if (outer.length < 3) continue;
    const referenceLongitude = outer.reduce((sum, coordinate) => sum + coordinate[0], 0) / outer.length;
    const holes = polygon.slice(1)
      .map((ring) => cleanAndUnwrapRing(ring, referenceLongitude))
      .filter((ring) => ring.length >= 3);
    const vertices = outer.map(([longitude, latitude]) => new THREE.Vector2(longitude, latitude));
    const holeVertices = holes.map((ring) => ring.map(([longitude, latitude]) => new THREE.Vector2(longitude, latitude)));
    const rings = [outer, ...holes];
    const flatCoordinates = rings.flat();
    for (const triangle of THREE.ShapeUtils.triangulateShape(vertices, holeVertices)) {
      const points = triangle.map((index) => {
        const coordinate = flatCoordinates[index]!;
        const point = latLonToVector(coordinate[1], coordinate[0], radius);
        return new THREE.Vector3(point.x, point.y, point.z);
      });
      appendSphericalTriangle(points[0]!, points[1]!, points[2]!);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
