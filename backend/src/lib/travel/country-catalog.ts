import { createHash } from 'node:crypto';
import { countryCodeSchema } from '@/lib/db/users.node';

type FeatureCatalog = { features: Array<{ properties: { name: string; countryCode: string; latitude: number; longitude: number } }> };
const sourceFiles = ['../../../../mobile/app/src/data/countries-110m.json', '../../../../mobile/app/src/data/countries-small.json'];
const sourceRows = (await Promise.all(sourceFiles.map((path) => Bun.file(new URL(path, import.meta.url)).json() as Promise<FeatureCatalog>))).flatMap(({ features }) => features.map(({ properties }) => properties));
const countryNameOverrides = await Bun.file(new URL('../../../../mobile/app/src/data/country-name-overrides.json', import.meta.url)).json() as Record<string, string>;
const sourceByCode = new Map(sourceRows.map((country) => [country.countryCode, country]));
const missing = [
  ['BQ', 'Caribbean Netherlands', 12.18, -68.24], ['BV', 'Bouvet Island', -54.42, 3.36], ['CC', 'Cocos (Keeling) Islands', -12.16, 96.87],
  ['CX', 'Christmas Island', -10.49, 105.63], ['GF', 'French Guiana', 3.93, -53.13], ['GI', 'Gibraltar', 36.14, -5.35],
  ['GP', 'Guadeloupe', 16.27, -61.55], ['MQ', 'Martinique', 14.64, -61.02], ['RE', 'Réunion', -21.13, 55.53],
  ['SJ', 'Svalbard and Jan Mayen', 78.72, 20.35], ['TK', 'Tokelau', -9.2, -171.85], ['UM', 'United States Minor Outlying Islands', 19.28, 166.65],
  ['YT', 'Mayotte', -12.83, 45.17],
] as const;
for (const [countryCode, name, latitude, longitude] of missing) sourceByCode.set(countryCode, { countryCode, name, latitude, longitude });

export const COUNTRY_CATALOG = Object.freeze(countryCodeSchema.options.map((countryCode) => {
  const source = sourceByCode.get(countryCode);
  if (!source) throw new Error(`Canonical country catalog is missing ${countryCode}.`);
  return Object.freeze({
    key: `c${createHash('sha256').update(`country\0${countryCode}`).digest('hex').slice(0, 24)}`,
    name: countryNameOverrides[countryCode] ?? source.name,
    countryCode,
    latitude: source.latitude, longitude: source.longitude,
  });
}));
