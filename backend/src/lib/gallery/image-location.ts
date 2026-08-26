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

export class GalleryImageInputError extends Error {
  readonly code = 'GALLERY_IMAGE_INVALID_INPUT';

  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'GalleryImageInputError'; }
}

const TRANSIENT_DECODER_DIAGNOSTIC = /\b(?:out of memory|memory exhausted|bad[_ ]alloc|allocat(?:e|ion)|resource temporarily unavailable|too many open files|permission denied|operation not permitted|no such file|file not found|file system|filesystem|disk|i\/o error|socket|network|system error|thread|concurren|deadlock|internal (?:error|failure)|assert(?:ion)?|panic)\b/i;
const DETERMINISTIC_DECODER_DIAGNOSTICS = [
  /^(?:Input buffer has corrupt header:\s*)?(?:VipsJpeg|jpegload_buffer):\s*.*(?:premature end|corrupt JPEG|invalid JPEG|bad Huffman|bad DCT|unsupported marker|extraneous bytes).*$/i,
  /^(?:Input buffer has corrupt header:\s*)?(?:VipsPng|pngload_buffer):\s*.*(?:IDAT stream error|invalid chunk|chunk checksum|CRC error|libspng read error|unexpected end|truncated|corrupt).*$/i,
  /^(?:Input buffer has corrupt header:\s*)?(?:VipsGif|gifload_buffer):\s*.*(?:unexpected end|truncated|invalid GIF|bad LZW|corrupt).*$/i,
  /^(?:Input buffer has corrupt header:\s*)?(?:VipsWebp|webpload_buffer|webp):\s*.*(?:unable to parse image|parse error|truncated|invalid WebP|corrupt).*$/i,
] as const;

/**
 * Sharp/libvips exposes decoder failures as plain Error messages, without a stable code or class.
 * Keep this allowlist format-specific so only deterministic input corruption becomes permanent;
 * resource, system, concurrency, and unknown runtime failures must remain retryable.
 */
export function galleryImageInputErrorFromDecoder(error: unknown): GalleryImageInputError | null {
  if (!(error instanceof Error)) return null;
  const diagnostic = error.message.trim();
  if (!diagnostic || TRANSIENT_DECODER_DIAGNOSTIC.test(diagnostic)) return null;
  return DETERMINISTIC_DECODER_DIAGNOSTICS.some((pattern) => pattern.test(diagnostic))
    ? new GalleryImageInputError('The image payload could not be decoded.', { cause: error })
    : null;
}

const ascii = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
const u16be = (bytes: Uint8Array, offset: number) => bytes[offset]! * 256 + bytes[offset + 1]!;
const u16le = (bytes: Uint8Array, offset: number) => bytes[offset]! + bytes[offset + 1]! * 256;
const u24le = (bytes: Uint8Array, offset: number) => bytes[offset]! + bytes[offset + 1]! * 256 + bytes[offset + 2]! * 65_536;
const u32be = (bytes: Uint8Array, offset: number) => bytes[offset]! * 16_777_216 + bytes[offset + 1]! * 65_536 + bytes[offset + 2]! * 256 + bytes[offset + 3]!;
const u32le = (bytes: Uint8Array, offset: number) => bytes[offset]! + bytes[offset + 1]! * 256 + bytes[offset + 2]! * 65_536 + bytes[offset + 3]! * 16_777_216;

function pngDimensions(bytes: Uint8Array) {
  if (bytes.length < 45 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return null;
  let dimensions: { width: number; height: number } | null = null;
  let hasImageData = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = u32be(bytes, offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > bytes.length) return null;
    const type = ascii(bytes, offset + 4, 4);
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13 || dimensions) return null;
      dimensions = { width: u32be(bytes, offset + 8), height: u32be(bytes, offset + 12) };
    } else if (type === 'IDAT') hasImageData = true;
    else if (type === 'IEND') return length === 0 && end === bytes.length && hasImageData ? dimensions : null;
    offset = end;
  }
  return null;
}

function jpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return null;
  for (let offset = 2; offset + 3 < bytes.length - 2;) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length - 2) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return length >= 7 ? { width: u16be(bytes, offset + 5), height: u16be(bytes, offset + 3) } : null;
    offset += length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array) {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP' || u32le(bytes, 4) + 8 !== bytes.length) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X') return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  if (chunk === 'VP8L' && bytes[20] === 0x2f) { const bits = u32le(bytes, 21); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }; }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
  return null;
}

function validateGalleryImageInput(bytes: Uint8Array) {
  let dimensions: { width: number; height: number } | null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) dimensions = jpegDimensions(bytes);
  else if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') dimensions = bytes.length >= 14 && bytes.at(-1) === 0x3b ? { width: u16le(bytes, 6), height: u16le(bytes, 8) } : null;
  else if (ascii(bytes, 0, 4) === 'RIFF') dimensions = webpDimensions(bytes);
  else dimensions = pngDimensions(bytes);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width * dimensions.height > 100_000_000) throw new GalleryImageInputError('The image payload is malformed or exceeds the supported dimensions.');
}

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
  validateGalleryImageInput(bytes);
  try {
    const pipeline = sharp(bytes, { animated: false, failOn: 'error', limitInputPixels: 100_000_000 });
    const metadata = await pipeline.metadata();
    const coordinates = extractExifCoordinates(metadata.exif) ?? (validCoordinates(suppliedCoordinates) ? suppliedCoordinates : undefined);
    const sanitized = await pipeline.rotate().jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
    return { bytes: new Uint8Array(sanitized), coordinates };
  } catch (error) {
    throw galleryImageInputErrorFromDecoder(error) ?? error;
  }
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
