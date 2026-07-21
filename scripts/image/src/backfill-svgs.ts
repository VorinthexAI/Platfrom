import { loadConfig } from "./config";
import { ensureRuntime } from "./filesystem";
import { RegistryStore } from "./registry";
import { createLogoSvgs } from "./svg";

export async function backfillLogoSvgs(): Promise<{ updated: number }> {
  const config = loadConfig();
  await ensureRuntime(config);
  const registry = new RegistryStore(config.rootDir);
  const assets = await registry.listAssets();
  let updated = 0;

  for (const asset of assets) {
    let touched = false;
    for (const version of asset.versions) {
      if ((version.solidPath && !version.solidSvgPath) || (version.transparentPath && !version.transparentSvgPath)) {
        const svgPaths = await createLogoSvgs({
          config,
          assetName: asset.name,
          solidPath: version.solidPath,
          transparentPath: version.transparentPath
        });
        version.solidSvgPath ||= svgPaths.solidSvgPath;
        version.transparentSvgPath ||= svgPaths.transparentSvgPath;
        touched = true;
        updated += 1;
      }
    }
    if (touched) await registry.upsertAsset(asset);
  }

  return { updated };
}

if (import.meta.main) {
  backfillLogoSvgs()
    .then((result) => console.log(`Backfilled SVGs for ${result.updated} logo version(s).`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
