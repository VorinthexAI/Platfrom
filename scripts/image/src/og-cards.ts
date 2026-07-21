import { mkdir } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { loadConfig } from "./config";
import { atomicWrite, ensureRuntime } from "./filesystem";
import { RegistryStore } from "./registry";
import { hashText, nowIso, rel, slugify } from "./utils";
import { getEntityBySlug } from "../../../web/app/src/lib/galaxy/registry-helpers";

type SocialCardKind = "opengraph" | "twitter";

type SocialCardTarget = {
  slug: string;
  name: string;
  routePath: string;
  subdomain: string;
  category: "master-brand" | "product" | "capability" | "orchestrator" | "announcement";
};

const DEFAULT_BASE_URL = "http://localhost:3000";

const SUBDOMAIN_SLUGS = [
  "apollo",
  "archive",
  "ascend",
  "athena",
  "atlas",
  "aura",
  "command",
  "compass",
  "core",
  "echo",
  "forge",
  "gallery",
  "harmony",
  "helios",
  "hermes",
  "hunt",
  "iris",
  "launch",
  "ledger",
  "matrix",
  "mercury",
  "metis",
  "orbit",
  "phoenix",
  "pillar",
  "sentinel",
  "signal",
  "studio",
  "themis",
  "vulcan",
] as const;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function imagePathFor(routePath: string, kind: SocialCardKind): string {
  const normalized = routePath === "/" ? "" : routePath.replace(/\/$/, "");
  return `${normalized}/${kind === "opengraph" ? "opengraph-image" : "twitter-image"}`;
}

function entityCategory(type: string): SocialCardTarget["category"] {
  if (type === "product" || type === "capability" || type === "orchestrator") return type;
  if (type === "star") return "master-brand";
  return "announcement";
}

function socialTargets(): SocialCardTarget[] {
  const root = getEntityBySlug("nexus");
  const targets: SocialCardTarget[] = [
    {
      slug: "vorinthex",
      name: root?.name ?? "Vorinthex AI",
      routePath: "/",
      subdomain: "vorinthex.com",
      category: "master-brand",
    },
  ];

  for (const slug of SUBDOMAIN_SLUGS) {
    if (slug === "hunt") {
      targets.push({
        slug,
        name: "The Hunt",
        routePath: "/hunt",
        subdomain: "hunt.vorinthex.com",
        category: "announcement",
      });
      continue;
    }

    const entity = getEntityBySlug(slug);
    if (!entity) throw new Error(`No registry entity found for social card slug "${slug}".`);
    targets.push({
      slug: entity.slug,
      name: entity.name,
      routePath: entity.routes.path,
      subdomain: `${slug}.vorinthex.com`,
      category: entityCategory(entity.type),
    });
  }

  return targets;
}

async function fetchPng(baseUrl: string, target: SocialCardTarget, kind: SocialCardKind): Promise<Uint8Array> {
  const url = new URL(imagePathFor(target.routePath, kind), baseUrl);
  const response = await fetch(url, {
    headers: {
      host: target.subdomain,
      accept: "image/png",
    },
  });
  if (!response.ok) {
    throw new Error(`${target.slug} ${kind}: ${response.status} ${response.statusText} from ${url.toString()}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("image/png")) {
    throw new Error(`${target.slug} ${kind}: expected image/png, got ${contentType || "unknown content-type"}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function main() {
  const config = loadConfig();
  await ensureRuntime(config);
  const registry = new RegistryStore(config.rootDir);
  const baseUrl = argValue("--base-url") ?? process.env.WEB_BASE_URL ?? DEFAULT_BASE_URL;
  const only = argValue("--slug");
  const targets = socialTargets().filter((target) => !only || target.slug === only);
  if (targets.length === 0) throw new Error(`No social card targets matched --slug ${only}`);

  let generated = 0;
  for (const target of targets) {
    const asset = await registry.createAsset({
      name: `${target.name} Social Cards`,
      slug: `social-card-${target.slug}`,
      category: "announcement",
      description: `Open Graph and Twitter preview cards for ${target.subdomain}.`,
      designIntent: "Materialized 1200x630 social preview images generated from the live Next.js metadata image routes.",
    });

    const nextNumber = Math.max(0, ...asset.versions.map((version) => version.version)) + 1;
    const versionId = `v${nextNumber}`;
    const assetDir = path.join(config.rootDir, "assets", "announcement", asset.slug, versionId);
    await mkdir(assetDir, { recursive: true });

    const opengraphPath = path.join(assetDir, "opengraph-1200x630.png");
    const twitterPath = path.join(assetDir, "twitter-1200x630.png");
    const prompt = `Materialize social preview cards for ${target.subdomain} from Next.js metadata image routes.`;
    const fullPrompt = [
      `Target: ${target.name}`,
      `Subdomain: ${target.subdomain}`,
      `Canonical route: ${target.routePath}`,
      `Open Graph route: ${imagePathFor(target.routePath, "opengraph")}`,
      `Twitter route: ${imagePathFor(target.routePath, "twitter")}`,
      `Base URL: ${baseUrl}`,
    ].join("\n");

    const [opengraph, twitter] = await Promise.all([
      fetchPng(baseUrl, target, "opengraph"),
      fetchPng(baseUrl, target, "twitter"),
    ]);
    await atomicWrite(opengraphPath, opengraph);
    await atomicWrite(twitterPath, twitter);

    const metadataPath = path.join(assetDir, "metadata.json");
    const metadata = {
      assetId: asset.id,
      versionId,
      target,
      baseUrl,
      size: "1200x630",
      opengraphPath: rel(config.rootDir, opengraphPath),
      twitterPath: rel(config.rootDir, twitterPath),
      promptHash: hashText(fullPrompt),
      createdAt: nowIso(),
    };
    await atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

    await registry.addVersion(asset, {
      prompt,
      fullPrompt,
      slideshowPath: rel(config.rootDir, metadataPath),
      previewPath: rel(config.rootDir, opengraphPath),
      slidePaths: [rel(config.rootDir, opengraphPath), rel(config.rootDir, twitterPath)],
      metadataPath: rel(config.rootDir, metadataPath),
      accepted: true,
      rejected: false,
      notes: `Generated Open Graph and Twitter cards for ${target.subdomain}.`,
    });
    generated += 1;
    console.log(chalk.green(`Generated ${target.subdomain}: ${rel(config.rootDir, opengraphPath)}, ${rel(config.rootDir, twitterPath)}`));
  }

  console.log(chalk.green(`Social card generation complete: ${generated} targets.`));
}

main().catch((error) => {
  console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
