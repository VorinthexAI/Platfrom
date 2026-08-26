import { beforeEach, describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { clearImageLocationCache, GalleryImageInputError, galleryImageInputErrorFromDecoder, reverseGeocodeImage, sanitizeGalleryImage } from './image-location';

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
    expect(metadata.format).toBe('png');
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
  });

  test('uses supplied coordinates when normalized bytes have no EXIF', async () => {
    const source = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const result = await sanitizeGalleryImage(source, { latitude: 40.7128, longitude: -74.006 });
    expect(result.coordinates).toEqual({ latitude: 40.7128, longitude: -74.006 });
  });

  test('reports structurally malformed image bytes with a typed input error', async () => {
    await expect(sanitizeGalleryImage(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).rejects.toBeInstanceOf(GalleryImageInputError);
    await expect(sanitizeGalleryImage(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).rejects.toMatchObject({ code: 'GALLERY_IMAGE_INVALID_INPUT' });
  });

  test('normalizes PNG, GIF, and WebP sanitizer inputs to PNG', async () => {
    for (const format of ['png', 'gif', 'webp'] as const) {
      const source = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#336699' } })[format]().toBuffer();
      const result = await sanitizeGalleryImage(source);
      await expect(sharp(result.bytes).metadata()).resolves.toMatchObject({ format: 'png', width: 3, height: 2 });
      expect(result.bytes.subarray(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    }
  });

  test('classifies only recognizable decoder corruption diagnostics', () => {
    for (const message of [
      'Input buffer has corrupt header: VipsJpeg: premature end of JPEG image',
      'pngload_buffer: IDAT stream error',
      'Input buffer has corrupt header: gifload_buffer: Unexpected end of GIF source data',
      'Input buffer has corrupt header: webp: unable to parse image',
    ]) expect(galleryImageInputErrorFromDecoder(new Error(message))).toBeInstanceOf(GalleryImageInputError);

    for (const message of [
      'pngload_buffer: out of memory while reading corrupt image',
      'VipsJpeg: unable to allocate memory',
      'gifload_buffer: resource temporarily unavailable',
      'webp: internal error',
      'permission denied',
      'worker concurrency limit reached',
      'unknown libvips failure',
    ]) expect(galleryImageInputErrorFromDecoder(new Error(message))).toBeNull();
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
