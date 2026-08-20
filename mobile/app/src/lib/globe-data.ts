import * as THREE from "three";

import countriesJson from "@/data/countries-110m.json";
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
  features: [...smallCountriesJson.features, ...countriesJson.features],
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
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const polygon of polygons) {
    const [outer, ...holes] = polygon;
    if (!outer) continue;
    const vertices = outer.map(([longitude, latitude]) => new THREE.Vector2(longitude, latitude));
    const holeVertices = holes.map((ring) => ring.map(([longitude, latitude]) => new THREE.Vector2(longitude, latitude)));
    const rings = [outer, ...holes];
    const flatCoordinates = rings.flat();
    for (const triangle of THREE.ShapeUtils.triangulateShape(vertices, holeVertices)) {
      for (const index of triangle) {
        const coordinate = flatCoordinates[index];
        if (!coordinate) continue;
        const point = latLonToVector(coordinate[1], coordinate[0], radius);
        positions.push(point.x, point.y, point.z);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
