import { mkdir } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { atomicWrite, exists, readText } from "./filesystem";
import { createSolidFromTransparent, resizePng, resizeWebp } from "./image";
import type { AssetRecord, AssetVersion, EngineConfig } from "./types";
import type { RegistryStore } from "./registry";
import { nowIso } from "./utils";

const defaultSizes = [128, 256, 512, 1024] as const;

export async function exportAssetPackage(config: EngineConfig, registry: RegistryStore, asset: AssetRecord, version: AssetVersion, sizes: number[] = [...defaultSizes]): Promise<string> {
  const packageDir = path.join(config.rootDir, "outputs/packages", asset.slug, version.id);
  await mkdir(packageDir, { recursive: true });
  if (!version.transparentPath && !version.solidPath) throw new Error("Version has no image paths to export.");

  const transparentSource = version.transparentPath ? path.join(config.rootDir, version.transparentPath) : undefined;
  const solidSource = version.solidPath ? path.join(config.rootDir, version.solidPath) : undefined;
  const solidForExport = solidSource || path.join(packageDir, `${asset.slug}-solid-source.png`);
  if (!solidSource && transparentSource) await createSolidFromTransparent(transparentSource, solidForExport, config);

  for (const size of sizes) {
    if (transparentSource && await exists(transparentSource)) {
      await resizePng(transparentSource, path.join(packageDir, `${asset.slug}-transparent-${size}.png`), size);
    }
    if (await exists(solidForExport)) {
      await resizePng(solidForExport, path.join(packageDir, `${asset.slug}-solid-${size}.png`), size);
    }
  }

  if (version.metadataPath) {
    await Bun.write(path.join(packageDir, "metadata.json"), Bun.file(path.join(config.rootDir, version.metadataPath)));
  }
  await atomicWrite(path.join(packageDir, "prompt.md"), version.fullPrompt);
  if (version.reviewPath && await exists(path.join(config.rootDir, version.reviewPath))) {
    await Bun.write(path.join(packageDir, "review.md"), Bun.file(path.join(config.rootDir, version.reviewPath)));
  }

  await registry.appendExport({
    exportId: nanoid(12),
    assetId: asset.id,
    versionId: version.id,
    path: path.relative(config.rootDir, packageDir).replace(/\\/g, "/"),
    createdAt: nowIso()
  });
  return packageDir;
}

export async function createFullAssetPackage(config: EngineConfig, registry: RegistryStore, asset: AssetRecord, version: AssetVersion): Promise<string> {
  const packageDir = await exportAssetPackage(config, registry, asset, version, [16, 32, 64, 128, 180, 192, 256, 512, 1024, 2048]);
  const transparentSource = version.transparentPath ? path.join(config.rootDir, version.transparentPath) : undefined;
  const solidSource = version.solidPath ? path.join(config.rootDir, version.solidPath) : undefined;
  if (transparentSource && await exists(transparentSource)) {
    for (const size of [256, 512, 1024]) await resizeWebp(transparentSource, path.join(packageDir, `${asset.slug}-transparent-${size}.webp`), size);
  }
  if (solidSource && await exists(solidSource)) {
    for (const size of [256, 512, 1024]) await resizeWebp(solidSource, path.join(packageDir, `${asset.slug}-solid-${size}.webp`), size);
  }
  await atomicWrite(path.join(packageDir, `${asset.slug}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="${asset.name}">
  <title>${asset.name}</title>
  <desc>Placeholder only. Vectorization is not available in the local engine.</desc>
</svg>
`);
  const existingReview = version.reviewPath ? await readText(path.join(config.rootDir, version.reviewPath)) : "";
  await atomicWrite(path.join(packageDir, "README.md"), `# ${asset.name} Asset Package

Asset: ${asset.slug}
Version: ${version.id}

Includes PNG transparent, PNG solid, WebP derivatives, favicon/app icon sizes, metadata, prompt snapshot, review, and an SVG placeholder.

${existingReview ? "## Review\n\n" + existingReview : ""}
`);
  return packageDir;
}
