import { mkdir } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { loadConfig } from "./config";
import { exists } from "./filesystem";
import { RegistryStore } from "./registry";

const WEB_PUBLIC_DIR = path.resolve(import.meta.dir, "../../../web/app/public/social-cards");

function publicSlug(assetSlug: string): string {
  return assetSlug.replace(/^social-card-/, "");
}

async function copyCard(source: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  await Bun.write(destination, Bun.file(source));
}

async function main() {
  const config = loadConfig();
  const registry = new RegistryStore(config.rootDir);
  const assets = (await registry.listAssets()).filter((asset) => asset.slug.startsWith("social-card-"));

  let published = 0;
  for (const asset of assets) {
    const version = asset.versions.find((entry) => entry.id === asset.currentVersionId) ?? asset.versions.at(-1);
    const [openGraphRel, twitterRel] = version?.slidePaths ?? [];
    if (!version || !openGraphRel || !twitterRel) {
      console.log(chalk.yellow(`Skipping ${asset.slug}: missing current Open Graph/Twitter slides.`));
      continue;
    }

    const openGraphSource = path.join(config.rootDir, openGraphRel);
    const twitterSource = path.join(config.rootDir, twitterRel);
    if (!await exists(openGraphSource) || !await exists(twitterSource)) {
      console.log(chalk.yellow(`Skipping ${asset.slug}: source PNG missing.`));
      continue;
    }

    const slug = publicSlug(asset.slug);
    const targetDir = path.join(WEB_PUBLIC_DIR, slug);
    await copyCard(openGraphSource, path.join(targetDir, "opengraph.png"));
    await copyCard(twitterSource, path.join(targetDir, "twitter.png"));
    published += 1;
  }

  console.log(chalk.green(`Published ${published} social-card assets to ${path.relative(process.cwd(), WEB_PUBLIC_DIR).replace(/\\/g, "/")}.`));
}

main().catch((error) => {
  console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
