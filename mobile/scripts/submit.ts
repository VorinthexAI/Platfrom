/**
 * Vorinthex Core — store submission automation.
 *
 * Run from the repo root:  bun run submit  [apple|google|all|assets|validate]
 *
 * Automates everything the public store APIs allow:
 *  - App Store Connect: categories, name/subtitle/privacy URL, version
 *    metadata per locale, screenshot upload, and the exact territory list
 *    (EU + EFTA Europe + GB + US/CA/AU only).
 *  - Google Play: contact details, listings per locale, icon/feature
 *    graphic/screenshots, optional .aab upload with a draft release, and
 *    a country-availability diff (Play has no write API for countries —
 *    the script prints the exact Console checklist instead).
 *  - Store assets: screenshots + feature graphic + icon generated from
 *    the real app via its web export.
 *
 * Binaries: you upload the .ipa yourself (Transporter/altool/eas submit);
 * the .aab is uploaded automatically when mobile/artifacts/*.aab exists.
 */
import { existsSync } from "node:fs";

import { AscClient } from "./lib/asc";
import {
  allCountries,
  appleCredentials,
  appleTerritories,
  googleCredentials,
  loadStores,
  resolveScriptPath,
  type StoresConfig,
} from "./lib/config";
import { selectMenu } from "./lib/menu";
import { PlayClient, imageFiles } from "./lib/play";
import { generateStoreAssets } from "./lib/screenshots";

type Target = "apple" | "google" | "all" | "assets" | "validate";

const manualSteps: string[] = [];

function heading(text: string): void {
  console.log(`\n=== ${text} ${"=".repeat(Math.max(0, 56 - text.length))}`);
}

function step(text: string): void {
  console.log(`\n- ${text}`);
}

/* ------------------------------------------------------------------ */
/* Validation (always runs first)                                      */
/* ------------------------------------------------------------------ */

function validate(config: StoresConfig): boolean {
  heading("Validate stores.json");
  let ok = true;
  const countries = allCountries(config);
  console.log(`  app          ${config.app.name} (${config.app.bundleId} / ${config.app.packageName}) v${config.app.versionString}`);
  console.log(`  countries    ${countries.length}: ${countries.join(" ")}`);
  console.log(`  apple terr.  ${appleTerritories(config).join(" ")}`);

  const checks: Array<{ label: string; path: string; required: boolean }> = [
    ...Object.entries(config.apple.screenshots).map(([displayType, dir]) => ({
      label: `apple screenshots ${displayType}`,
      path: dir,
      required: true,
    })),
    { label: "play icon", path: config.google.images.icon, required: true },
    { label: "play feature graphic", path: config.google.images.featureGraphic, required: true },
    { label: "play phone screenshots", path: config.google.images.phoneScreenshots, required: true },
    { label: "ipa (manual upload)", path: config.apple.artifacts.ipa, required: false },
    { label: "aab (auto upload)", path: config.google.artifacts.aab, required: false },
  ];
  for (const check of checks) {
    const path = resolveScriptPath(check.path);
    const isDir = !/\.[a-z0-9]+$/i.test(path);
    const exists = existsSync(path) && (!isDir || imageFiles(path).length > 0);
    const mark = exists ? "ok " : check.required ? "MISSING" : "absent (optional)";
    if (!exists && check.required) ok = false;
    console.log(`  ${mark.padEnd(18)} ${check.label} -> ${check.path}`);
  }

  const playShots = imageFiles(resolveScriptPath(config.google.images.phoneScreenshots));
  if (playShots.length > 0 && (playShots.length < 2 || playShots.length > 8)) {
    console.log(`  WARN Play requires 2-8 phone screenshots (found ${playShots.length}).`);
    ok = false;
  }
  console.log(`  creds apple  ${appleCredentials() ? "found" : "missing (ASC_ISSUER_ID / ASC_KEY_ID / ASC_PRIVATE_KEY[_PATH])"}`);
  console.log(`  creds google ${googleCredentials() ? "found" : "missing (GOOGLE_PLAY_SERVICE_ACCOUNT_JSON|_PATH)"}`);
  if (!ok) console.log('\n  Run "bun run submit assets" to generate missing screenshots/graphics.');
  return ok;
}

/* ------------------------------------------------------------------ */
/* Apple                                                               */
/* ------------------------------------------------------------------ */

async function submitApple(config: StoresConfig): Promise<void> {
  heading("App Store Connect");
  const creds = appleCredentials();
  if (!creds) {
    throw new Error(
      "Apple credentials missing. Provide ASC_ISSUER_ID, ASC_KEY_ID and ASC_PRIVATE_KEY " +
        "(inline .p8 PEM) or ASC_PRIVATE_KEY_PATH — via env or .github/environments.json " +
        "(secrets.prod.mobile). Create the key in App Store Connect > Users and Access > " +
        "Integrations, role App Manager.",
    );
  }
  const asc = new AscClient(creds);

  step(`Locate app ${config.app.bundleId}`);
  const app = await asc.findApp(config.app.bundleId);
  if (!app) {
    throw new Error(
      `No App Store Connect app with bundle id ${config.app.bundleId}. The app record must be ` +
        "created once by hand (App Store Connect > My Apps > +) — the public API cannot create apps.",
    );
  }
  console.log(`  found app id ${app.id}`);

  step("App info: categories, name, subtitle, privacy policy URL");
  await asc.updateAppInfo(
    app.id,
    config.apple.appInfo.primaryCategory,
    config.apple.appInfo.secondaryCategory,
    config.apple.appInfo.localizations,
  );
  console.log(`  ${Object.keys(config.apple.appInfo.localizations).join(", ")} updated`);

  step(`Ensure editable version ${config.app.versionString}`);
  const version = await asc.ensureVersion(app.id, config.app.versionString, config.apple.version.releaseType);
  console.log(`  version id ${version.id}`);

  step("Version metadata per locale");
  const localizationIds = await asc.updateVersionLocalizations(version.id, config.apple.version.localizations);
  console.log(`  ${[...localizationIds.keys()].join(", ")} updated`);

  step("Screenshots");
  for (const [locale, localizationId] of localizationIds) {
    for (const [displayType, dir] of Object.entries(config.apple.screenshots)) {
      const count = await asc.replaceScreenshots(localizationId, displayType, resolveScriptPath(dir));
      console.log(`  ${locale} ${displayType}: ${count} uploaded`);
    }
  }

  step("Territory availability (EU + EFTA + GB + US/CA/AU only)");
  const territories = appleTerritories(config);
  await asc.setTerritoryAvailability(app.id, territories);
  const current = await asc.getTerritoryAvailability(app.id);
  console.log(`  declared ${territories.length}, store now reports ${current.length}: ${current.join(" ")}`);

  const ipa = resolveScriptPath(config.apple.artifacts.ipa);
  manualSteps.push(
    existsSync(ipa)
      ? `Apple: upload the build — the REST API cannot ingest .ipa files. From macOS: Transporter.app, or "xcrun altool --upload-app -f ${ipa} -t ios --apiKey ${creds.keyId} --apiIssuer ${creds.issuerId}", or "eas submit -p ios".`
      : `Apple: build the .ipa, drop it at ${config.apple.artifacts.ipa}, then upload it with Transporter / altool / "eas submit -p ios".`,
    "Apple: complete the App Privacy questionnaire (privacy nutrition labels) in App Store Connect — not exposed by the public API.",
    "Apple: confirm the age-rating questionnaire and Free pricing, attach the uploaded build to the version, then submit for review.",
  );
}

/* ------------------------------------------------------------------ */
/* Google                                                              */
/* ------------------------------------------------------------------ */

async function submitGoogle(config: StoresConfig): Promise<void> {
  heading("Google Play Console");
  const creds = googleCredentials();
  if (!creds) {
    throw new Error(
      "Google credentials missing. Provide GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (inline) or " +
        "GOOGLE_PLAY_SERVICE_ACCOUNT_PATH — via env or .github/environments.json " +
        "(secrets.prod.mobile). Create a service account in Google Cloud, then invite its " +
        "email in Play Console > Users and permissions with app access.",
    );
  }
  const play = new PlayClient(creds);
  const pkg = config.app.packageName;

  step("Open edit");
  const editId = await play.createEdit(pkg);
  console.log(`  edit ${editId}`);

  step("Store listing details + localizations");
  await play.updateDetails(pkg, editId, {
    contactEmail: config.google.listing.contactEmail,
    contactWebsite: config.google.listing.contactWebsite,
    defaultLanguage: config.google.listing.defaultLanguage,
  });
  for (const [language, listing] of Object.entries(config.google.listing.localizations)) {
    await play.updateListing(pkg, editId, language, listing);
    console.log(`  listing ${language} updated`);
  }

  step("Images");
  const language = config.google.listing.defaultLanguage;
  const imageSets: Array<[string, string[]]> = [
    ["icon", [resolveScriptPath(config.google.images.icon)].filter((f) => existsSync(f))],
    ["featureGraphic", [resolveScriptPath(config.google.images.featureGraphic)].filter((f) => existsSync(f))],
    ["phoneScreenshots", imageFiles(resolveScriptPath(config.google.images.phoneScreenshots))],
    ...(config.google.images.sevenInchScreenshots
      ? ([["sevenInchScreenshots", imageFiles(resolveScriptPath(config.google.images.sevenInchScreenshots))]] as Array<[string, string[]]>)
      : []),
    ...(config.google.images.tenInchScreenshots
      ? ([["tenInchScreenshots", imageFiles(resolveScriptPath(config.google.images.tenInchScreenshots))]] as Array<[string, string[]]>)
      : []),
  ];
  for (const [type, files] of imageSets) {
    if (files.length === 0) {
      console.log(`  ${type}: no files, skipped`);
      continue;
    }
    const count = await play.replaceImages(pkg, editId, language, type, files);
    console.log(`  ${type}: ${count} uploaded`);
  }

  step("Binary (.aab)");
  const aab = resolveScriptPath(config.google.artifacts.aab);
  if (existsSync(aab)) {
    const versionCode = await play.uploadBundle(pkg, editId, aab);
    console.log(`  uploaded bundle versionCode ${versionCode}`);
    await play.setTrackRelease(pkg, editId, config.google.release.track, {
      status: config.google.release.status,
      versionCodes: [versionCode],
      releaseNotes: Object.entries(config.google.release.releaseNotes).map(([lang, text]) => ({
        language: lang,
        text,
      })),
    });
    console.log(`  ${config.google.release.status} release staged on track "${config.google.release.track}"`);
  } else {
    console.log(`  ${config.google.artifacts.aab} not found — skipping (upload later and re-run).`);
    manualSteps.push(
      `Google: build the .aab, drop it at ${config.google.artifacts.aab} and re-run "bun run submit google" to upload it and stage the release.`,
    );
  }

  step("Country availability check (Play has no write API for this)");
  const desired = allCountries(config);
  try {
    const availability = await play.getCountryAvailability(pkg, editId, config.google.release.track);
    const current = (availability.countries ?? []).map((c) => c.countryCode).sort();
    const missing = desired.filter((c) => !current.includes(c));
    const extra = current.filter((c) => !desired.includes(c));
    console.log(`  current: ${current.length ? current.join(" ") : "(none / defaults)"}`);
    console.log(`  restOfWorld: ${availability.restOfWorld ?? false}, syncWithProduction: ${availability.syncWithProduction ?? false}`);
    if (missing.length || extra.length || availability.restOfWorld) {
      manualSteps.push(
        `Google: set country availability by hand — Play Console > Release > Production > Countries/regions. ` +
          `Select EXACTLY these ${desired.length} countries and disable "rest of world": ${desired.join(", ")}.` +
          (missing.length ? ` Currently missing: ${missing.join(", ")}.` : "") +
          (extra.length ? ` Currently extra (remove): ${extra.join(", ")}.` : ""),
      );
    } else {
      console.log("  country list already matches the desired availability.");
    }
  } catch (error) {
    console.log(`  could not read availability (${(error as Error).message.slice(0, 120)})`);
    manualSteps.push(
      `Google: set country availability by hand — Play Console > Release > Production > Countries/regions. ` +
        `Select EXACTLY these ${desired.length} countries and nothing else: ${desired.join(", ")}.`,
    );
  }

  step("Commit edit");
  await play.validateEdit(pkg, editId);
  await play.commitEdit(pkg, editId);
  console.log("  edit validated and committed");

  manualSteps.push(
    "Google: complete the one-time Console questionnaires the API does not cover — content rating (IARC), data safety form, target audience, and app access.",
  );
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log("Vorinthex Core — store submission");
  const config = loadStores();

  const argTarget = process.argv[2] as Target | undefined;
  const target =
    argTarget && ["apple", "google", "all", "assets", "validate"].includes(argTarget)
      ? argTarget
      : await selectMenu<Target>("Submit to which store?", [
          { label: "Apple", value: "apple", hint: "App Store Connect: metadata, screenshots, territories" },
          { label: "Google", value: "google", hint: "Play Console: listing, images, aab, country check" },
          { label: "All", value: "all", hint: "Apple then Google" },
          { label: "Generate store assets", value: "assets", hint: "screenshots + feature graphic + icon from the app" },
          { label: "Validate only", value: "validate", hint: "dry-run: config, files, credentials" },
        ]);
  if (!target) {
    console.log("Cancelled.");
    return;
  }

  if (target === "assets") {
    heading("Generate store assets");
    await generateStoreAssets(config);
    validate(config);
    return;
  }

  const valid = validate(config);
  if (target === "validate") {
    process.exitCode = valid ? 0 : 1;
    return;
  }
  if (!valid) {
    throw new Error('stores.json validation failed — fix the MISSING entries above (try "bun run submit assets").');
  }

  if (target === "apple" || target === "all") await submitApple(config);
  if (target === "google" || target === "all") await submitGoogle(config);

  if (manualSteps.length > 0) {
    heading("Remaining manual steps");
    manualSteps.forEach((text, i) => console.log(`  ${i + 1}. ${text}`));
  }
  heading("Done");
}

main().catch((error) => {
  console.error(`\nFAILED: ${(error as Error).message}`);
  process.exit(1);
});
