import { beforeEach, describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { clearImageLocationCache, reverseGeocodeImage, sanitizeGalleryImage } from './image-location';

beforeEach(() => clearImageLocationCache());

describe('Gallery image location processing', () => {
  test('extracts GPS before stripping all EXIF metadata', async () => {
    const source = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#336699' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'Private camera' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '59/1 19/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '18/1 4/1 0/1' } })
      .toBuffer();

    const result = await sanitizeGalleryImage(source);
    const metadata = await sharp(result.bytes).metadata();

    expect(result.coordinates).toEqual({ latitude: 59 + 19 / 60, longitude: 18 + 4 / 60 });
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(metadata.format).toBe('jpeg');
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
  });

  test('uses supplied coordinates when normalized JPEG bytes have no EXIF', async () => {
    const source = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const result = await sanitizeGalleryImage(source, { latitude: 40.7128, longitude: -74.006 });
    expect(result.coordinates).toEqual({ latitude: 40.7128, longitude: -74.006 });
  });

  test('reverse geocodes with storage terms and caches rounded coordinates', async () => {
    const calls: unknown[] = [];
    const client = { async send(command: { input: unknown }) {
      calls.push(command.input);
      return { ResultItems: [{ Address: { Locality: 'Stockholm', Country: { Name: 'Sweden', Code2: 'se' } } }] };
    } } as never;

    const [first, second] = await Promise.all([
      reverseGeocodeImage({ latitude: 59.3293, longitude: 18.0686 }, { client }),
      reverseGeocodeImage({ latitude: 59.32931, longitude: 18.06861 }, { client }),
    ]);
    expect(first).toEqual({ city: 'Stockholm', country: 'Sweden', countryCode: 'SE' });
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ QueryPosition: [18.0686, 59.3293], MaxResults: 1, IntendedUse: 'Storage', Language: 'en' });
  });
});
