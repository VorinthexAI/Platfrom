#!/usr/bin/env bun
// Builds the JSON payload for the GitHub `CONFIG` secret from
// environments/.env.prod plus the handful of deployment values that don't
// live in that file (Vercel token/team, per-project Vercel project id, and
// each app's production URL).
//
// Usage:
//   bun environments/scripts/build-config.ts \
//     --vercel-token=... \
//     --vorinthex-project-id=prj_... \
//     --orbit-project-id=prj_... \
//     > /tmp/config.json
//   gh secret set CONFIG < /tmp/config.json
//
// deploy.yml reads this via fromJSON(secrets.CONFIG), e.g.
// fromJSON(secrets.CONFIG).vorinthex.url or .vercel.team_id.
// Re-run this whenever environments/.env.prod changes.

import { readFileSync } from "node:fs";

const DEFAULT_VERCEL_TEAM_ID = "team_TuCe5vyzHhXf3aId8h8CpFyP";

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
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

const args = parseArgs();
const envFile = args["env-file"] ?? "environments/.env.prod";
const env = parseEnvFile(envFile);

const config = {
  vercel: {
    token: args["vercel-token"] ?? "",
    team_id: args["vercel-team-id"] ?? DEFAULT_VERCEL_TEAM_ID,
  },
  vorinthex: {
    url: args["vorinthex-url"] ?? env.VORINTHEX_NEXT_PUBLIC_SITE_URL ?? "",
    vercel_project_id: args["vorinthex-project-id"] ?? "",
  },
  orbit: {
    url: args["orbit-url"] ?? env.ORBIT_NEXT_PUBLIC_SITE_URL ?? "",
    vercel_project_id: args["orbit-project-id"] ?? "",
  },
  env,
};

console.log(JSON.stringify(config, null, 2));
