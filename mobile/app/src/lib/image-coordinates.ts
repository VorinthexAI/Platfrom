export type CapturedImage = { uri: string; width: number; height: number; exif?: Record<string, unknown> | null; latitude?: number; longitude?: number };

function coordinate(value: unknown, reference: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return reference === "S" || reference === "W" ? -Math.abs(value) : value;
  if (!Array.isArray(value) || value.length < 3 || !value.slice(0, 3).every((part) => typeof part === "number" && Number.isFinite(part))) return undefined;
  const decimal = value[0]! + value[1]! / 60 + value[2]! / 3_600;
  return reference === "S" || reference === "W" ? -decimal : decimal;
}

export function capturedImageCoordinates(image: CapturedImage) {
  const latitude = image.latitude ?? coordinate(image.exif?.GPSLatitude, image.exif?.GPSLatitudeRef);
  const longitude = image.longitude ?? coordinate(image.exif?.GPSLongitude, image.exif?.GPSLongitudeRef);
  if (latitude === undefined || longitude === undefined || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  return { latitude, longitude };
}
