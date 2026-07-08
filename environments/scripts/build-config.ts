#!/usr/bin/env bun
// Builds the JSON payload for .github/.configs/secrets.json (gitignored,
// local-only — see .github/.configs/secrets.json.example for the schema)
// from environments/{vorinthex,orbit,backend}/.env.prod plus each app's
// production URL. Vercel has been fully removed: the web app and backend now
// deploy to AWS ECS (container images in ECR), so no Vercel token, team id, or
// per-project Vercel project id is emitted anymore.
//
// Usage:
//   bun environments/scripts/build-config.ts \
//     --vorinthex-url=https://www.vorinthex.com \
//     --orbit-url=https://orbit.vorinthex.com \
//     > .github/.configs/secrets.json
//   bash environments/scripts/sync-configs.sh secrets
//
// deploy.yml reads the resulting CONFIG secret via fromJSON(secrets.CONFIG),
// e.g. fromJSON(secrets.CONFIG).vorinthex.url, .vorinthex.env, or
// .env (the backend SSM env). Re-run this whenever any .env.prod file changes.

import { readFileSync } from "node:fs";

function parseArgs() {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([a-z-]+)=([\s\S]*)$/);
    if (!match) continue;
    args[match[1]] = match[2];
  }
  return args;
}

function parseEnvFile(path: string) {
  const env: Record<string, string> = {};
  const contents = readFileSync(path, "utf8");
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    // An unset key and a key set to "" behave differently downstream (code
    // that does `process.env.X ?? fallback` only falls through on
    // null/undefined, not ""), so drop empty values rather than ship a
    // literal empty string that can silently shadow a working fallback.
    if (!value) continue;
    env[key] = value;
  }
  return env;
}

const args = parseArgs();

const vorinthexEnv = parseEnvFile(args["vorinthex-env-file"] ?? "environments/vorinthex/.env.prod");
const orbitEnv = parseEnvFile(args["orbit-env-file"] ?? "environments/orbit/.env.prod");
const backendEnv = parseEnvFile(args["backend-env-file"] ?? "environments/backend/.env.prod");

function withServerBackendEnv(env: Record<string, string>) {
  return {
    ...env,
    BACKEND_API_URL: env.BACKEND_API_URL ?? env.API_BASE_URL ?? env.NEXT_PUBLIC_API_BASE_URL ?? "",
    BACKEND_API_KEY: env.BACKEND_API_KEY ?? env.NEXT_PUBLIC_BACKEND_API_KEY ?? "",
  };
}

const config = {
  vorinthex: {
    url: args["vorinthex-url"] ?? vorinthexEnv.NEXT_PUBLIC_SITE_URL ?? "",
    env: withServerBackendEnv(vorinthexEnv),
  },
  orbit: {
    url: args["orbit-url"] ?? orbitEnv.NEXT_PUBLIC_SITE_URL ?? "",
    env: withServerBackendEnv(orbitEnv),
  },
  env: backendEnv,
};

console.log(JSON.stringify(config, null, 2));
