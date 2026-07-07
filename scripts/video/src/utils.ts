import { createHash } from "node:crypto";
import path from "node:path";

export function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function rel(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).replace(/\\/g, "/");
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
