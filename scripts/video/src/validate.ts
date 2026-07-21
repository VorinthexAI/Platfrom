import path from "node:path";
import { loadVideoConfig } from "./config";
import { ensureVideoRuntime, exists } from "./filesystem";
import { VideoRegistryStore } from "./registry";

export async function validateVideos(): Promise<{ ok: boolean; problems: string[] }> {
  const config = await loadVideoConfig();
  await ensureVideoRuntime(config.rootDir);
  const registry = new VideoRegistryStore(config.rootDir);
  const problems: string[] = [];
  for (const asset of await registry.list()) {
    for (const version of asset.versions) {
      if (version.status !== "completed") continue;
      if (!version.videoPath) problems.push(`${asset.slug} ${version.id}: missing videoPath`);
      else if (!await exists(path.join(config.rootDir, version.videoPath))) problems.push(`${asset.slug} ${version.id}: file missing`);
      if (!await exists(path.join(config.rootDir, version.metadataPath))) problems.push(`${asset.slug} ${version.id}: metadata missing`);
    }
  }
  return { ok: problems.length === 0, problems };
}

if (import.meta.main) {
  validateVideos()
    .then((result) => {
      if (result.ok) console.log("Video validation passed.");
      else {
        console.error(result.problems.join("\n"));
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
