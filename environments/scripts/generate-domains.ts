#!/usr/bin/env bun
/**
 * Generates environments/domains.json — the apex domain and every subdomain
 * slug the platform serves, DERIVED FROM THE GALAXY REGISTRY so the list is
 * never hand-maintained.
 *
 * Source of truth: web/app/src/lib/galaxy/registry.ts
 * (VORINTHEX_GALAXY_REGISTRY). Every product, capability, and orchestrator
 * declares its own `routes.subdomains` (e.g. ["core.vorinthex.com"]); this
 * script reads those, groups the slugs under their apex domain, and folds in
 * the cave subdomains (hunt) that route inside the app but are not registry
 * entities. Add a product/capability/orchestrator to the registry, or a cave
 * below, and re-running this picks it up automatically.
 *
 *   DO NOT EDIT environments/domains.json BY HAND — it is generated.
 *   Regenerate with:  bun run environments/scripts/generate-domains.ts
 *                     (or:  bun run domains:generate)
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { GalaxyEntity } from "../../web/app/src/lib/galaxy/registry-types";
import { VORINTHEX_GALAXY_REGISTRY } from "../../web/app/src/lib/galaxy/registry";

/**
 * Cave subdomains: routed inside the app (e.g. hunt.vorinthex.com → /hunt via
 * web/app/src/proxy.ts) but not modelled as galaxy entities, so they carry no
 * registry `routes.subdomains`. Listed here as { host }, parsed the same way
 * as registry subdomains so their apex is derived, not assumed.
 */
const CAVE_SUBDOMAINS: string[] = ["hunt.vorinthex.com"];

/**
 * Infrastructure subdomains: not app routes and not galaxy entities, but they
 * still resolve to the same edge (CloudFront) and the ALB host-routes them to
 * the right target group. `api.vorinthex.com` fronts the backend ECS service.
 * Included so the Cloudflare DNS sync points them at CloudFront too.
 */
const INFRA_SUBDOMAINS: string[] = ["api.vorinthex.com", "www.vorinthex.com"];

/** The apex domain used as the JSON key when an entity declares no subdomain. */
const DEFAULT_APEX = "vorinthex.com";

/**
 * Split a fully-qualified subdomain host into its slug (the prefix) and its
 * apex domain (the registrable last two labels). "core.vorinthex.com" =>
 * { slug: "core", apex: "vorinthex.com" }.
 */
function parseHost(host: string): { slug: string; apex: string } | null {
  const labels = host.trim().toLowerCase().split(".").filter(Boolean);
  if (labels.length < 3) return null; // needs at least slug + apex (a.b.c)
  const apex = labels.slice(-2).join(".");
  const slug = labels.slice(0, -2).join(".");
  if (!slug) return null;
  return { slug, apex };
}

function collectEntities(): GalaxyEntity[] {
  const { products, capabilities, orchestrators } = VORINTHEX_GALAXY_REGISTRY;
  return [
    ...Object.values(products),
    ...Object.values(capabilities),
    ...Object.values(orchestrators),
  ];
}

function buildDomains(): Record<string, string[]> {
  const byApex = new Map<string, Set<string>>();

  const add = (host: string) => {
    const parsed = parseHost(host);
    if (!parsed) return;
    const set = byApex.get(parsed.apex) ?? new Set<string>();
    set.add(parsed.slug);
    byApex.set(parsed.apex, set);
  };

  for (const entity of collectEntities()) {
    for (const host of entity.routes.subdomains ?? []) add(host);
  }
  for (const host of CAVE_SUBDOMAINS) add(host);
  for (const host of INFRA_SUBDOMAINS) add(host);

  // Ensure the apex key exists even if nothing declared it explicitly.
  if (!byApex.has(DEFAULT_APEX)) byApex.set(DEFAULT_APEX, new Set());

  // Deterministic output: apex keys sorted, slug arrays sorted + unique.
  const result: Record<string, string[]> = {};
  for (const apex of [...byApex.keys()].sort()) {
    result[apex] = [...byApex.get(apex)!].sort();
  }
  return result;
}

const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "domains.json");
const domains = buildDomains();
writeFileSync(outPath, `${JSON.stringify(domains, null, 2)}\n`, "utf8");

const total = Object.values(domains).reduce((n, slugs) => n + slugs.length, 0);
console.log(`Wrote ${outPath}`);
console.log(`Domains: ${Object.keys(domains).length}, subdomain slugs: ${total}`);
