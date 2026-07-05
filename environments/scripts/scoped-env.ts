#!/usr/bin/env bun
// Loads a single shared environments/.env.* file, keeps only the keys
// belonging to one project (its PREFIX_ lines, prefix stripped, plus the
// shared NODE_ENV), and execs the given command with that scoped env.
//
// Usage: bun scoped-env.ts <PREFIX> <envFile> -- <command> [args...]

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const separatorIndex = args.indexOf("--");

if (separatorIndex === -1 || separatorIndex < 2) {
  console.error("Usage: scoped-env.ts <PREFIX> <envFile> -- <command> [args...]");
  process.exit(1);
}

const [prefix, envFilePath] = args;
const command = args.slice(separatorIndex + 1);

if (command.length === 0) {
  console.error("Usage: scoped-env.ts <PREFIX> <envFile> -- <command> [args...]");
  process.exit(1);
}

const SHARED_KEYS = new Set(["NODE_ENV"]);
const prefixToken = `${prefix}_`;

const env: Record<string, string> = { ...(process.env as Record<string, string>) };
const contents = readFileSync(envFilePath, "utf8");

for (const rawLine of contents.split("\n")) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;

  const eq = line.indexOf("=");
  if (eq === -1) continue;

  const key = line.slice(0, eq).trim();
  const value = line.slice(eq + 1).trim();

  if (SHARED_KEYS.has(key)) {
    env[key] = value;
  } else if (key.startsWith(prefixToken)) {
    env[key.slice(prefixToken.length)] = value;
  }
}

const child = Bun.spawn(command, {
  env,
  stdio: ["inherit", "inherit", "inherit"],
});

process.exit(await child.exited);
