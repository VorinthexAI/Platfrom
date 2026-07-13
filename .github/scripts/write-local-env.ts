#!/usr/bin/env bun
// Writes a plain dotenv file from .github/environments.json so tools that
// expect a real .env file (Next.js's automatic .env.local loading, etc.) keep
// working now that per-workspace environments/*/.env.* files are gone.
//
// Usage:
//   bun run .github/scripts/write-local-env.ts <mode> <section> <outFile>
//   bun run .github/scripts/write-local-env.ts dev web web/app/.env.local
//
// <mode> is "dev" or "prod"; <section> is a key under secrets.dev / secrets.prod
// in .github/environments.json (e.g. "web", "vorinthex", "backend").
// Requires .github/environments.json to be git-crypt unlocked.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const [mode, section, outFile] = process.argv.slice(2);
if (!mode || !section || !outFile || (mode !== "dev" && mode !== "prod")) {
  console.error("Usage: bun run .github/scripts/write-local-env.ts <dev|prod> <section> <outFile>");
  process.exit(1);
}

// Resolve relative to the repo root (this file lives at .github/scripts/),
// not process.cwd(), so this works whether invoked from the repo root or via
// `bun run --cwd web/app`.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENVIRONMENTS_JSON_PATH = resolve(REPO_ROOT, ".github/environments.json");
const resolvedOutFile = resolve(REPO_ROOT, outFile);

if (!existsSync(ENVIRONMENTS_JSON_PATH)) {
  console.error(`::error::${ENVIRONMENTS_JSON_PATH} not found (still git-crypt encrypted? run \`git-crypt unlock\`).`);
  process.exit(1);
}

const parsed = JSON.parse(readFileSync(ENVIRONMENTS_JSON_PATH, "utf8"));
// secrets.prod.backend doesn't exist as its own key — the backend's prod env
// lives at the top-level secrets.prod.env (see .github/environments.json).
const values = mode === "dev"
  ? parsed?.secrets?.dev?.[section]
  : section === "backend"
    ? parsed?.secrets?.prod?.env
    : parsed?.secrets?.prod?.[section]?.env;

if (!values || typeof values !== "object") {
  console.error(`::error::secrets.${mode}.${section} not found in ${ENVIRONMENTS_JSON_PATH}.`);
  process.exit(1);
}

const lines = Object.entries(values as Record<string, unknown>)
  .filter(([, value]) => typeof value === "string" && value !== "")
  .map(([key, value]) => `${key}=${value}`);

writeFileSync(resolvedOutFile, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${resolvedOutFile} from secrets.${mode}.${section}`);
