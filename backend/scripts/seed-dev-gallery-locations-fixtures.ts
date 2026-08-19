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
  const offset = 70 + visualIndex * 43;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset=".55" stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[2]}"/></linearGradient></defs><rect width="640" height="480" fill="url(#g)"/><circle cx="${offset}" cy="${110 + visualIndex * 29}" r="72" fill="#fff" opacity=".24"/><path d="M0 ${330 - visualIndex * 9} Q180 ${230 + visualIndex * 13} 350 340 T640 280 V480 H0Z" fill="#101820" opacity=".27"/><rect x="${260 + visualIndex * 17}" y="90" width="180" height="260" rx="18" fill="#fff" opacity=".13"/></svg>`;
}
