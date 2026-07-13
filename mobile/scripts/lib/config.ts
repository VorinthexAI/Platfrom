import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(SCRIPTS_DIR, "../..");
export const MOBILE_APP_DIR = resolve(REPO_ROOT, "mobile/app");

/** Resolve a stores.json path relative to mobile/scripts. */
export function resolveScriptPath(path: string): string {
  return isAbsolute(path) ? path : resolve(SCRIPTS_DIR, path);
}

/* ------------------------------------------------------------------ */
/* stores.json schema                                                  */
/* ------------------------------------------------------------------ */

const localeKey = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, "BCP-47 locale like en-US");

const appleVersionLocalizationSchema = z.strictObject({
  description: z.string().min(10).max(4000),
  keywords: z.string().max(100),
  promotionalText: z.string().max(170).optional(),
  whatsNew: z.string().max(4000).optional(),
  supportUrl: z.url(),
  marketingUrl: z.url().optional(),
});

const appleSchema = z.strictObject({
  appInfo: z.strictObject({
    primaryCategory: z.string(),
    secondaryCategory: z.string().optional(),
    localizations: z.record(
      localeKey,
      z.strictObject({
        name: z.string().max(30),
        subtitle: z.string().max(30).optional(),
        privacyPolicyUrl: z.url(),
      }),
    ),
  }),
  version: z.strictObject({
    releaseType: z.enum(["MANUAL", "AFTER_APPROVAL", "SCHEDULED"]),
    localizations: z.record(localeKey, appleVersionLocalizationSchema),
  }),
  screenshots: z.record(z.string(), z.string()),
});

const googleSchema = z.strictObject({
  listing: z.strictObject({
    defaultLanguage: localeKey,
    contactEmail: z.email(),
    contactWebsite: z.url(),
    localizations: z.record(
      localeKey,
      z.strictObject({
        title: z.string().max(30),
        shortDescription: z.string().max(80),
        fullDescription: z.string().min(10).max(4000),
        video: z.url().optional(),
      }),
    ),
  }),
  images: z.strictObject({
    icon: z.string(),
    featureGraphic: z.string(),
    phoneScreenshots: z.string(),
    sevenInchScreenshots: z.string().optional(),
    tenInchScreenshots: z.string().optional(),
  }),
  /** Track whose country availability the script reads for the diff report. */
  availabilityCheckTrack: z.string(),
});

const storesSchema = z.strictObject({
  app: z.strictObject({
    name: z.string(),
    bundleId: z.string().regex(/^[a-zA-Z0-9.-]+$/),
    packageName: z.string().regex(/^[a-zA-Z0-9._]+$/),
    primaryLocale: localeKey,
    versionString: z.string().regex(/^\d+\.\d+(\.\d+)?$/),
    copyright: z.string(),
  }),
  availability: z.strictObject({
    note: z.string().optional(),
    regions: z.record(z.string(), z.array(z.string().regex(/^[A-Z]{2}$/))),
  }),
  apple: appleSchema,
  google: googleSchema,
});

export type StoresConfig = z.infer<typeof storesSchema>;

export function loadStores(): StoresConfig {
  const path = resolve(SCRIPTS_DIR, "stores.json");
  const parsed = storesSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const countries = allCountries(parsed);
  for (const code of countries) {
    if (!(code in ALPHA2_TO_APPLE_TERRITORY)) {
      throw new Error(`No Apple territory mapping for country ${code} — extend ALPHA2_TO_APPLE_TERRITORY.`);
    }
  }
  return parsed;
}

/** Flat, de-duplicated ISO alpha-2 list of every allowed country. */
export function allCountries(config: StoresConfig): string[] {
  return [...new Set(Object.values(config.availability.regions).flat())].sort();
}

/** Apple's App Store Connect territory ids for the allowed countries. */
export function appleTerritories(config: StoresConfig): string[] {
  return allCountries(config).map((code) => ALPHA2_TO_APPLE_TERRITORY[code]!);
}

/**
 * ISO 3166-1 alpha-2 → Apple territory id (alpha-3). Only the markets we
 * ship to; extend when the availability list grows.
 */
export const ALPHA2_TO_APPLE_TERRITORY: Record<string, string> = {
  AT: "AUT", BE: "BEL", BG: "BGR", HR: "HRV", CY: "CYP", CZ: "CZE",
  DK: "DNK", EE: "EST", FI: "FIN", FR: "FRA", DE: "DEU", GR: "GRC",
  HU: "HUN", IE: "IRL", IT: "ITA", LV: "LVA", LT: "LTU", LU: "LUX",
  MT: "MLT", NL: "NLD", PL: "POL", PT: "PRT", RO: "ROU", SK: "SVK",
  SI: "SVN", ES: "ESP", SE: "SWE",
  GB: "GBR", IS: "ISL", LI: "LIE", NO: "NOR", CH: "CHE",
  US: "USA", CA: "CAN", AU: "AUS",
};

/* ------------------------------------------------------------------ */
/* Credentials                                                         */
/* ------------------------------------------------------------------ */

export type AppleCredentials = { issuerId: string; keyId: string; privateKey: string };
export type GoogleCredentials =
  | { kind: "serviceAccountKey"; clientEmail: string; privateKey: string }
  | { kind: "accessToken"; accessToken: string };

type EnvSection = Record<string, string>;

/**
 * Secrets follow the repo convention: the git-crypt encrypted
 * .github/environments.json is the canonical store (secrets.prod.mobile,
 * then secrets.dev.mobile); env vars are only a local override. Returns
 * null when the file is absent or locked.
 */
function environmentsMobileSection(): EnvSection | null {
  const path = resolve(REPO_ROOT, ".github/environments.json");
  if (!existsSync(path)) return null;
  const raw = readFileSync(path);
  if (raw.subarray(0, 10).includes(0)) return null; // git-crypt locked blob
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as {
      secrets?: Record<string, Record<string, unknown>>;
    };
    const section = parsed.secrets?.prod?.mobile ?? parsed.secrets?.dev?.mobile;
    return section && typeof section === "object" ? (section as EnvSection) : null;
  } catch {
    return null;
  }
}

function secret(name: string): string | undefined {
  const fromFile = environmentsMobileSection()?.[name];
  return (fromFile !== undefined && fromFile !== "" ? fromFile : undefined) ?? process.env[name];
}

function maybeFile(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const path = resolveScriptPath(value);
  return existsSync(path) ? readFileSync(path, "utf8") : value;
}

export function appleCredentials(): AppleCredentials | null {
  const issuerId = secret("ASC_ISSUER_ID");
  const keyId = secret("ASC_KEY_ID");
  const privateKey = maybeFile(secret("ASC_PRIVATE_KEY") ?? secret("ASC_PRIVATE_KEY_PATH"));
  if (!issuerId || !keyId || !privateKey?.includes("PRIVATE KEY")) return null;
  return { issuerId, keyId, privateKey };
}

export function googleCredentials(): GoogleCredentials | null {
  const raw = maybeFile(
    secret("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON") ?? secret("GOOGLE_PLAY_SERVICE_ACCOUNT_PATH"),
  );
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
      if (parsed.client_email && parsed.private_key) {
        return {
          kind: "serviceAccountKey",
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key,
        };
      }
    } catch {
      // fall through to the keyless path
    }
  }

  // Keyless alternative for orgs enforcing iam.disableServiceAccountKeyCreation:
  //   gcloud auth print-access-token --impersonate-service-account=SA_EMAIL
  const accessToken = secret("GOOGLE_PLAY_ACCESS_TOKEN");
  if (accessToken) return { kind: "accessToken", accessToken };
  return null;
}
