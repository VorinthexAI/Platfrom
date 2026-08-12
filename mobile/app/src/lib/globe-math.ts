export type GlobeVector = Readonly<{ x: number; y: number; z: number }>;
export type LongitudeLatitude = readonly [longitude: number, latitude: number];
export type LinearRing = readonly LongitudeLatitude[];
export type PolygonCoordinates = readonly LinearRing[];
export type MultiPolygonCoordinates = readonly PolygonCoordinates[];

const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;

export function latLonToVector(latitude: number, longitude: number, radius = 1): GlobeVector {
  const latitudeRadians = latitude * DEGREES_TO_RADIANS;
  const longitudeRadians = longitude * DEGREES_TO_RADIANS;
  const horizontal = Math.cos(latitudeRadians) * radius;

  return {
    x: horizontal * Math.sin(longitudeRadians),
    y: Math.sin(latitudeRadians) * radius,
    z: horizontal * Math.cos(longitudeRadians),
  };
}

export function vectorToLatLon(vector: GlobeVector): { latitude: number; longitude: number } {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length === 0) throw new Error("Cannot convert a zero-length globe vector");

  return {
    latitude: Math.asin(vector.y / length) * RADIANS_TO_DEGREES,
    longitude: Math.atan2(vector.x, vector.z) * RADIANS_TO_DEGREES,
  };
}

function wrappedDelta(longitude: number, previousLongitude: number): number {
  return ((longitude - previousLongitude + 540) % 360) - 180;
}

export function pointInRing(longitude: number, latitude: number, ring: LinearRing): boolean {
  if (ring.length < 3) return false;

  const unwrappedLongitudes = new Array<number>(ring.length);
  const first = ring[0];
  if (!first) return false;
  unwrappedLongitudes[0] = first[0];
  for (let index = 1; index < ring.length; index += 1) {
    const current = ring[index];
    const previous = ring[index - 1];
    const previousUnwrapped = unwrappedLongitudes[index - 1];
    if (!current || !previous || previousUnwrapped === undefined) return false;
    unwrappedLongitudes[index] = previousUnwrapped + wrappedDelta(current[0], previous[0]);
  }
  const reference = unwrappedLongitudes.reduce((sum, value) => sum + value, 0) / unwrappedLongitudes.length;
  const queryLongitude = longitude + Math.round((reference - longitude) / 360) * 360;

  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    const currentX = unwrappedLongitudes[index];
    const previousX = unwrappedLongitudes[previous];
    if (!currentPoint || !previousPoint || currentX === undefined || previousX === undefined) continue;

    const currentY = currentPoint[1];
    const previousY = previousPoint[1];

    const crossesLatitude = currentY > latitude !== previousY > latitude;
    const edgeLongitude = previousX + ((latitude - previousY) * (currentX - previousX)) / (currentY - previousY);
    if (crossesLatitude && edgeLongitude > queryLongitude) inside = !inside;
  }

  return inside;
}

export function pointInPolygon(longitude: number, latitude: number, polygon: PolygonCoordinates): boolean {
  const exterior = polygon[0];
  if (!exterior || !pointInRing(longitude, latitude, exterior)) return false;

  for (let index = 1; index < polygon.length; index += 1) {
    const hole = polygon[index];
    if (hole && pointInRing(longitude, latitude, hole)) return false;
  }
  return true;
}

export function pointInMultiPolygon(
  longitude: number,
  latitude: number,
  polygons: MultiPolygonCoordinates,
): boolean {
  return polygons.some((polygon) => pointInPolygon(longitude, latitude, polygon));
}
