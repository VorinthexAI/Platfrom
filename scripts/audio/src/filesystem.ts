import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function atomicWrite(filePath: string, content: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content);
  await rename(tempPath, filePath);
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  if (!await exists(filePath)) return fallback;
  return await Bun.file(filePath).json() as T;
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function ensureAudioRuntime(rootDir: string): Promise<void> {
  for (const dir of ["registry", "outputs/audio", "runs", "prompts"]) {
    await mkdir(path.join(rootDir, dir), { recursive: true });
  }
  const registryPath = path.join(rootDir, "registry/audio.json");
  if (!await exists(registryPath)) await writeJson(registryPath, { audio: [] });
}
