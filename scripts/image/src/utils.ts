import { createHash } from "node:crypto";
import path from "node:path";

export function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function rel(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).replace(/\\/g, "/");
}

export function parseSize(size: `${number}x${number}`): { width: number; height: number } {
  const [width, height] = size.split("x").map(Number);
  return { width, height };
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}

export async function retry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await Bun.sleep(750 * (attempt + 1));
    }
  }
  throw lastError;
}
