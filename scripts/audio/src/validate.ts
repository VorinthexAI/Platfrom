import { stat } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { loadAudioConfig } from "./config";
import { ensureAudioRuntime } from "./filesystem";
import { AudioRegistryStore } from "./registry";

async function main(): Promise<void> {
  const config = await loadAudioConfig();
  await ensureAudioRuntime(config.rootDir);
  const registry = new AudioRegistryStore(config.rootDir);
  const assets = await registry.list();
  let missing = 0;

  for (const asset of assets) {
    for (const version of asset.versions) {
      if (version.status !== "completed" || !version.audioPath) continue;
      const filePath = path.join(config.rootDir, version.audioPath);
      try {
        const result = await stat(filePath);
        if (result.size <= 0) throw new Error("empty file");
      } catch {
        missing += 1;
        console.error(chalk.red(`Missing audio file: ${asset.slug} ${version.id} ${version.audioPath}`));
      }
    }
  }

  if (missing > 0) throw new Error(`Audio validation failed: ${missing} missing files.`);
  console.log(chalk.green(`Audio validation passed for ${assets.length} assets.`));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
