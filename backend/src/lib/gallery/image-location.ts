import { createHash } from 'node:crypto';
import { GeoPlacesClient, ReverseGeocodeCommand } from '@aws-sdk/client-geo-places';
import readExif from 'exif-reader';
import sharp from 'sharp';

export type ImageCoordinates = { latitude: number; longitude: number };
export type ImageLocation = {
  city?: string; country?: string; countryCode?: string;
  placeName?: string; placeSummary?: string;
  latitude?: number; longitude?: number;
  locationSource?: 'exif' | 'supplied' | 'place';
};

type ReverseGeocodeClient = Pick<GeoPlacesClient, 'send'>;
const locationCache = new Map<string, ImageLocation | null>();
const locationFlights = new Map<string, Promise<ImageLocation | undefined>>();
let client: GeoPlacesClient | undefined;

function validCoordinates(value: ImageCoordinates | undefined): value is ImageCoordinates {
  return Boolean(value && Number.isFinite(value.latitude) && value.latitude >= -90 && value.latitude <= 90 && Number.isFinite(value.longitude) && value.longitude >= -180 && value.longitude <= 180);
}

function dms(value: unknown, reference: unknown) {
  if (!Array.isArray(value) || value.length < 3 || !value.slice(0, 3).every((part) => typeof part === 'number' && Number.isFinite(part))) return undefined;
  const decimal = value[0]! + value[1]! / 60 + value[2]! / 3_600;
  return reference === 'S' || reference === 'W' ? -decimal : decimal;
}

export function extractExifCoordinates(exif: Buffer | undefined): ImageCoordinates | undefined {
  if (!exif) return undefined;
  try {
    const gps = readExif(exif).GPSInfo;
    const latitude = dms(gps?.GPSLatitude, gps?.GPSLatitudeRef);
    const longitude = dms(gps?.GPSLongitude, gps?.GPSLongitudeRef);
    const coordinates = latitude === undefined || longitude === undefined ? undefined : { latitude, longitude };
    return validCoordinates(coordinates) ? coordinates : undefined;
  } catch {
    return undefined;
  }
}

export async function sanitizeGalleryImage(bytes: Uint8Array, suppliedCoordinates?: ImageCoordinates) {
  const pipeline = sharp(bytes, { animated: false, failOn: 'error', limitInputPixels: 100_000_000 });
  const metadata = await pipeline.metadata();
  const coordinates = extractExifCoordinates(metadata.exif) ?? (validCoordinates(suppliedCoordinates) ? suppliedCoordinates : undefined);
  const sanitized = await pipeline.rotate().jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  return { bytes: new Uint8Array(sanitized), coordinates };
}

function cacheKey({ latitude, longitude }: ImageCoordinates) {
  const rounded = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  return createHash('sha256').update(rounded).digest('hex');
}

function canonicalCoordinates({ latitude, longitude }: ImageCoordinates): ImageCoordinates {
  return { latitude: Number(latitude.toFixed(4)), longitude: Number(longitude.toFixed(4)) };
}

function cache(value: string, location: ImageLocation | null) {
  if (locationCache.size >= 5_000) locationCache.delete(locationCache.keys().next().value!);
  locationCache.set(value, location);
  return location ?? undefined;
}

export async function reverseGeocodeImage(coordinates: ImageCoordinates, dependencies: { client?: ReverseGeocodeClient } = {}): Promise<ImageLocation | undefined> {
  if (!validCoordinates(coordinates)) return undefined;
  const canonical = canonicalCoordinates(coordinates);
  const key = cacheKey(canonical);
  if (locationCache.has(key)) return locationCache.get(key) ?? undefined;
  const existing = locationFlights.get(key);
  if (existing) return existing;
  const flight = (async () => {
    const geo = dependencies.client ?? (client ??= new GeoPlacesClient({ region: process.env.AWS_LOCATION_REGION ?? process.env.AWS_REGION ?? 'eu-north-1' }));
    const response = await geo.send(new ReverseGeocodeCommand({ QueryPosition: [canonical.longitude, canonical.latitude], MaxResults: 1, IntendedUse: 'Storage', Language: 'en' }));
    const address = response.ResultItems?.[0]?.Address;
    const city = address?.Locality ?? address?.District ?? address?.SubRegion?.Name;
    const country = address?.Country?.Name;
    const countryCode = address?.Country?.Code2?.toUpperCase();
    const location = {
      ...(city ? { city } : {}),
      ...(country ? { country } : {}),
      ...(countryCode?.length === 2 ? { countryCode } : {}),
    };
    return cache(key, Object.keys(location).length ? location : null);
  })();
  locationFlights.set(key, flight);
  try { return await flight; } finally { if (locationFlights.get(key) === flight) locationFlights.delete(key); }
}

export function clearImageLocationCache() {
  locationCache.clear();
  locationFlights.clear();
}
