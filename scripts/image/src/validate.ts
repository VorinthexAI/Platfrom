import path from "node:path";
import { loadConfig } from "./config";
import { ensureRuntime, exists } from "./filesystem";
import { validatePng } from "./image";
import { RegistryStore } from "./registry";

export async function validateLockedAssets(rootDir?: string): Promise<{ ok: boolean; problems: string[] }> {
  const config = loadConfig(rootDir);
  await ensureRuntime(config);
  const registry = new RegistryStore(config.rootDir);
  const assets = await registry.listAssets();
  const locks = await registry.getLocks();
  const problems: string[] = [];
  for (const [slug, lock] of Object.entries(locks)) {
    const asset = assets.find((entry) => entry.slug === slug || entry.id === lock.assetId);
    if (!asset) {
      if (lock.lockedVersionId !== "template") problems.push(`${slug}: lock has no asset record`);
      continue;
    }
    if (lock.lockedVersionId === "template") continue;
    const version = asset.versions.find((entry) => entry.id === lock.lockedVersionId);
    if (!version) {
      problems.push(`${slug}: locked version ${lock.lockedVersionId} is missing`);
      continue;
    }
    if (!version.solidPath || !await exists(path.join(config.rootDir, version.solidPath))) problems.push(`${slug}: missing solid PNG`);
    if (!version.transparentPath || !await exists(path.join(config.rootDir, version.transparentPath))) {
      problems.push(`${slug}: missing transparent PNG`);
    } else {
      const validation = await validatePng(path.join(config.rootDir, version.transparentPath), config, true);
      if (!validation.ok) problems.push(`${slug}: ${validation.problems.join(", ")}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

if (import.meta.main) {
  validateLockedAssets()
    .then((result) => {
      if (result.ok) {
        console.log("Locked asset validation passed.");
      } else {
        console.error(result.problems.join("\n"));
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
