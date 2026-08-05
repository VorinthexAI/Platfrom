import { mkdir } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { loadConfig } from "./config";
import { atomicWrite, ensureRuntime } from "./filesystem";
import { RegistryStore } from "./registry";
import { hashText, nowIso, rel } from "./utils";

const DEFAULT_BASE_URL = "http://localhost:3000";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function fetchPng(baseUrl: string, route: string): Promise<Uint8Array> {
  const response = await fetch(new URL(route, baseUrl), {
    headers: { host: "vorinthex.com", accept: "image/png" },
  });
  if (!response.ok) throw new Error(`${route}: ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function main() {
  const config = loadConfig();
  await ensureRuntime(config);
  const registry = new RegistryStore(config.rootDir);
  const baseUrl = argValue("--base-url") ?? process.env.WEB_BASE_URL ?? DEFAULT_BASE_URL;
  const asset = await registry.createAsset({
    name: "Vorinthex Social Cards",
    slug: "social-card-vorinthex",
    category: "announcement",
    description: "Open Graph and Twitter preview cards for vorinthex.com.",
    designIntent: "Materialized social previews from the Core website.",
  });
  const nextNumber = Math.max(0, ...asset.versions.map((version) => version.version)) + 1;
  const versionId = `v${nextNumber}`;
  const assetDir = path.join(config.rootDir, "assets", "announcement", asset.slug, versionId);
  await mkdir(assetDir, { recursive: true });
  const opengraphPath = path.join(assetDir, "opengraph-1200x630.png");
  const twitterPath = path.join(assetDir, "twitter-1200x630.png");
  const fullPrompt = `Materialize Core social cards from ${baseUrl}.`;
  const [opengraph, twitter] = await Promise.all([
    fetchPng(baseUrl, "/opengraph-image"),
    fetchPng(baseUrl, "/twitter-image"),
  ]);
  await atomicWrite(opengraphPath, opengraph);
  await atomicWrite(twitterPath, twitter);
  const metadataPath = path.join(assetDir, "metadata.json");
  await atomicWrite(metadataPath, `${JSON.stringify({ assetId: asset.id, versionId, baseUrl, promptHash: hashText(fullPrompt), createdAt: nowIso() }, null, 2)}\n`);
  await registry.addVersion(asset, {
    prompt: fullPrompt,
    fullPrompt,
    slideshowPath: rel(config.rootDir, metadataPath),
    previewPath: rel(config.rootDir, opengraphPath),
    slidePaths: [rel(config.rootDir, opengraphPath), rel(config.rootDir, twitterPath)],
    metadataPath: rel(config.rootDir, metadataPath),
    accepted: true,
    rejected: false,
    notes: "Generated Core social cards.",
  });
  console.log(chalk.green("Generated vorinthex.com social cards."));
}

main().catch((error) => {
  console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
