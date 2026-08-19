import { createHash } from 'node:crypto';
import { z } from 'zod';

export const GALLERY_LOCATION_FIXTURE_EMAIL = 'oscar.burman005@gmail.com';
export const GALLERY_LOCATION_FIXTURE_MARKER = 'Development Gallery location fixture';

const runIdSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{2,39}$/, 'Run id must be 3-40 lowercase letters, digits, or hyphens.');
const fixtureDefinitionSchema = z.object({
  slug: z.string(), city: z.string(), country: z.string(), countryCode: z.string().length(2),
  latitude: z.number(), longitude: z.number(), captionScore: z.number().int().min(1).max(100), colors: z.tuple([z.string(), z.string(), z.string()]),
}).strict();

const DEFINITIONS = fixtureDefinitionSchema.array().parse([
  { slug: 'stockholm-waterfront', city: 'Stockholm', country: 'Sweden', countryCode: 'SE', latitude: 59.3293, longitude: 18.0686, captionScore: 18, colors: ['#b7d5df', '#416d7c', '#e9c792'] },
  { slug: 'paris-evening', city: 'Paris', country: 'France', countryCode: 'FR', latitude: 48.8566, longitude: 2.3522, captionScore: 39, colors: ['#d8c9bd', '#685b73', '#ef9c72'] },
  { slug: 'new-york-grid', city: 'New York', country: 'United States', countryCode: 'US', latitude: 40.7128, longitude: -74.006, captionScore: 62, colors: ['#abc4cf', '#2d4459', '#e6a86c'] },
  { slug: 'tokyo-crossing', city: 'Tokyo', country: 'Japan', countryCode: 'JP', latitude: 35.6762, longitude: 139.6503, captionScore: 81, colors: ['#d7d1df', '#5d4172', '#ed6e75'] },
  { slug: 'cape-town-coast', city: 'Cape Town', country: 'South Africa', countryCode: 'ZA', latitude: -33.9249, longitude: 18.4241, captionScore: 96, colors: ['#83bdc5', '#345c62', '#e5c67d'] },
  { slug: 'london-river', city: 'London', country: 'United Kingdom', countryCode: 'GB', latitude: 51.5072, longitude: -0.1276, captionScore: 71, colors: ['#b9c3ca', '#34495e', '#d6a86e'] },
  { slug: 'rio-bay', city: 'Rio de Janeiro', country: 'Brazil', countryCode: 'BR', latitude: -22.9068, longitude: -43.1729, captionScore: 88, colors: ['#8fd3b5', '#216869', '#f4c95d'] },
  { slug: 'mexico-city-plaza', city: 'Mexico City', country: 'Mexico', countryCode: 'MX', latitude: 19.4326, longitude: -99.1332, captionScore: 54, colors: ['#e3b5a4', '#6f1d1b', '#f1c453'] },
  { slug: 'toronto-harbour', city: 'Toronto', country: 'Canada', countryCode: 'CA', latitude: 43.6532, longitude: -79.3832, captionScore: 76, colors: ['#b8d8e8', '#3b5b73', '#d98e73'] },
  { slug: 'sydney-harbour', city: 'Sydney', country: 'Australia', countryCode: 'AU', latitude: -33.8688, longitude: 151.2093, captionScore: 91, colors: ['#9ed8db', '#326273', '#f2b880'] },
  { slug: 'mumbai-market', city: 'Mumbai', country: 'India', countryCode: 'IN', latitude: 19.076, longitude: 72.8777, captionScore: 67, colors: ['#f0c987', '#8c5e58', '#d95d39'] },
  { slug: 'singapore-gardens', city: 'Singapore', country: 'Singapore', countryCode: 'SG', latitude: 1.3521, longitude: 103.8198, captionScore: 84, colors: ['#9bd8a6', '#275d4e', '#b8a1d9'] },
  { slug: 'dubai-skyline', city: 'Dubai', country: 'United Arab Emirates', countryCode: 'AE', latitude: 25.2048, longitude: 55.2708, captionScore: 79, colors: ['#e6d3ad', '#806443', '#8ec5d6'] },
  { slug: 'cairo-nile', city: 'Cairo', country: 'Egypt', countryCode: 'EG', latitude: 30.0444, longitude: 31.2357, captionScore: 58, colors: ['#d9bd8b', '#725b3f', '#6fa3a8'] },
  { slug: 'nairobi-hills', city: 'Nairobi', country: 'Kenya', countryCode: 'KE', latitude: -1.2921, longitude: 36.8219, captionScore: 73, colors: ['#b4c98a', '#40513b', '#d98f5c'] },
  { slug: 'buenos-aires-avenue', city: 'Buenos Aires', country: 'Argentina', countryCode: 'AR', latitude: -34.6037, longitude: -58.3816, captionScore: 64, colors: ['#b9d6e8', '#4a5578', '#e6a0a8'] },
  { slug: 'reykjavik-harbour', city: 'Reykjavik', country: 'Iceland', countryCode: 'IS', latitude: 64.1466, longitude: -21.9426, captionScore: 86, colors: ['#c5dce8', '#3f6070', '#d9b7c8'] },
  { slug: 'istanbul-bosphorus', city: 'Istanbul', country: 'Turkey', countryCode: 'TR', latitude: 41.0082, longitude: 28.9784, captionScore: 69, colors: ['#b8d1cf', '#365f66', '#d47f6a'] },
  { slug: 'seoul-night', city: 'Seoul', country: 'South Korea', countryCode: 'KR', latitude: 37.5665, longitude: 126.978, captionScore: 93, colors: ['#9da9d8', '#34345c', '#db6f91'] },
  { slug: 'bangkok-river', city: 'Bangkok', country: 'Thailand', countryCode: 'TH', latitude: 13.7563, longitude: 100.5018, captionScore: 61, colors: ['#e0bd83', '#76527a', '#d46a6a'] },
]);

export type GalleryLocationFixtureMode = 'dry-run' | 'execute' | 'verify' | 'cleanup';

export function parseGalleryLocationFixtureArgs(argv: readonly string[]) {
  const runArguments = argv.filter((argument) => argument.startsWith('--run-id='));
  if (runArguments.length !== 1) throw new Error('Exactly one explicit --run-id=<id> is required.');
  const runId = runIdSchema.parse(runArguments[0]!.slice('--run-id='.length));
  const selected = (['execute', 'verify', 'cleanup'] as const).filter((mode) => argv.includes(`--${mode}`));
  if (selected.length > 1) throw new Error('Choose only one of --execute, --verify, or --cleanup.');
  const allowed = new Set([runArguments[0]!, '--execute', '--verify', '--cleanup', '--duplicates']);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  const mode: GalleryLocationFixtureMode = selected.length === 0 ? 'dry-run' : selected[0]!;
  return { runId, mode, includeDuplicates: argv.includes('--duplicates') };
}

function requireLoopback(name: string, value: string | undefined) {
  let url: URL;
  try { url = new URL(value ?? ''); }
  catch { throw new Error(`${name} must be an explicit loopback URL.`); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error(`${name} must use localhost or a loopback address.`);
}

export function assertGalleryLocationFixtureEnvironment(environment: NodeJS.ProcessEnv) {
  if (environment.NODE_ENV?.toLowerCase() === 'production') throw new Error('Gallery location fixtures cannot run in production.');
  requireLoopback('ARANGO_URL', environment.ARANGO_URL);
  requireLoopback('S3_ENDPOINT_URL or AWS_ENDPOINT_URL', environment.S3_ENDPOINT_URL ?? environment.AWS_ENDPOINT_URL);
  if (environment.S3_BUCKET !== 'vorinthex-dev') throw new Error('Gallery location fixtures require S3_BUCKET=vorinthex-dev.');
}

export function galleryLocationFixtureKey(scopeKey: string, runId: string, kind: string, slug: string) {
  return `c${createHash('sha256').update(`gallery-location\0${scopeKey}\0${runId}\0${kind}\0${slug}`).digest('hex').slice(0, 24)}`;
}

export function buildGalleryLocationFixturePlan(scopeKey: string, runId: string, includeDuplicates: boolean) {
  runIdSchema.parse(runId);
  const definitions = includeDuplicates
    ? [...DEFINITIONS, { ...DEFINITIONS[0]!, slug: 'stockholm-waterfront-copy' }]
    : DEFINITIONS;
  const collectionKey = galleryLocationFixtureKey(scopeKey, runId, 'collection', 'locations');
  const marker = `${GALLERY_LOCATION_FIXTURE_MARKER}:${runId}`;
  return {
    email: GALLERY_LOCATION_FIXTURE_EMAIL,
    runId,
    marker,
    collection: {
      key: collectionKey,
      memberKey: galleryLocationFixtureKey(scopeKey, runId, 'collection-member', 'owner'),
      name: `Location QA [${runId}]`,
      description: `${marker}. Deterministic local-only Gallery UI data.`,
    },
    images: definitions.map((definition, index) => ({
      ...definition,
      key: galleryLocationFixtureKey(scopeKey, runId, 'image', definition.slug),
      captionKey: galleryLocationFixtureKey(scopeKey, runId, 'caption', definition.slug === 'stockholm-waterfront-copy' ? 'stockholm-waterfront' : definition.slug),
      placementKey: galleryLocationFixtureKey(scopeKey, runId, 'placement', definition.slug),
      filename: `${marker.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${definition.slug}.jpg`,
      visualIndex: definition.slug === 'stockholm-waterfront-copy' ? 0 : index,
      duplicateOf: definition.slug === 'stockholm-waterfront-copy' ? 'stockholm-waterfront' : null,
    })),
  };
}

export function galleryLocationFixtureSvg(visualIndex: number, colors: readonly [string, string, string]) {
  const circleX = 55 + (visualIndex * 73) % 530;
  const circleY = 65 + (visualIndex * 47) % 330;
  const circleRadius = 36 + (visualIndex * 11) % 52;
  const blockX = 35 + (visualIndex * 97) % 430;
  const blockY = 30 + (visualIndex * 61) % 190;
  const blockWidth = 95 + (visualIndex * 13) % 115;
  const blockHeight = 120 + (visualIndex * 17) % 190;
  const horizon = 260 + (visualIndex * 19) % 150;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset=".55" stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[2]}"/></linearGradient></defs><rect width="640" height="480" fill="url(#g)"/><circle cx="${circleX}" cy="${circleY}" r="${circleRadius}" fill="#fff" opacity=".3"/><path d="M0 ${horizon} Q${90 + visualIndex * 7} ${180 + (visualIndex * 23) % 170} ${260 + (visualIndex * 29) % 210} ${250 + (visualIndex * 31) % 150} T640 ${220 + (visualIndex * 37) % 180} V480 H0Z" fill="#101820" opacity=".32"/><rect x="${blockX}" y="${blockY}" width="${blockWidth}" height="${blockHeight}" rx="${10 + visualIndex % 24}" fill="#fff" opacity=".16"/></svg>`;
}
