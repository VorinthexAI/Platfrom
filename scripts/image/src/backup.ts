import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { ensureRuntime } from "./filesystem";
import { nowIso } from "./utils";

const backupTargets = ["registry", "memory", "design-system.md", "baseline-prompt.md"] as const;

export async function backupRegistry(rootDir?: string): Promise<string> {
  const config = loadConfig(rootDir);
  await ensureRuntime(config);
  const stamp = nowIso().replace(/[:.]/g, "-");
  const targetDir = path.join(config.rootDir, "backups", stamp);
  await mkdir(targetDir, { recursive: true });
  for (const target of backupTargets) {
    const source = path.join(config.rootDir, target);
    const destination = path.join(targetDir, target);
    await mkdir(path.dirname(destination), { recursive: true });
    await Bun.$`cp -R ${source} ${destination}`.quiet();
  }
  return targetDir;
}

if (import.meta.main) {
  backupRegistry()
    .then((dir) => console.log(`Backup written: ${dir}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
