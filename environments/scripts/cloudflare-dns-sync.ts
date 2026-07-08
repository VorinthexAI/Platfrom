#!/usr/bin/env bun
// Idempotent Cloudflare DNS synchronization for the Vorinthex universe.
//
// Source of truth: environments/domains.json, generated from the galaxy
// registry by another script. Shape:
//
//   { "vorinthex.com": ["core", "command", ..., "hunt"] }
//
// Each apex key becomes a proxied CNAME to the CloudFront target (Cloudflare
// "CNAME flattening" makes an apex CNAME legal), and every slug becomes a
// proxied CNAME `<slug>.<apex>` to the same target. Proxied CNAMEs are
// compatible with Cloudflare SSL/TLS "Full" mode: Cloudflare terminates TLS
// at the edge and re-encrypts to CloudFront (which serves a valid cert).
//
// The sync is idempotent: existing records are matched by name+type, updated
// only when content/proxied/type differ, created when missing, and never
// duplicated. Unrelated records in the zone are left untouched.
//
// Usage:
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... \
//     bun environments/scripts/cloudflare-dns-sync.ts
//
// Env:
//   CLOUDFLARE_API_TOKEN   (required) scoped token with Zone.DNS edit rights
//   CLOUDFLARE_ZONE_ID     (required) zone id for the apex domain
//   CLOUDFLARE_DNS_TARGET  (optional) CNAME target; default the CloudFront
//                          distribution domain below
//   DNS_APEX               (optional) apex to sync; default vorinthex.com.
//                          Only this apex (and its slugs) is synced even if
//                          domains.json contains multiple apex keys.
//   DOMAINS_FILE           (optional) path to domains.json override
//   DRY_RUN=1              log planned actions without mutating Cloudflare

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_TARGET = "d1zyw7lyzk1blr.cloudfront.net";
const DEFAULT_APEX = "vorinthex.com";
const DEFAULT_DOMAINS_FILE = "environments/domains.json";
const MAX_RETRIES = 5;

type CloudflareError = { code: number; message: string };

type CloudflareResponse<T> = {
  success: boolean;
  errors: CloudflareError[];
  messages: unknown[];
  result: T;
  result_info?: {
    page: number;
    per_page: number;
    total_count: number;
    total_pages: number;
  };
};

type DnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
};

type DesiredRecord = {
  name: string;
  type: "CNAME";
  content: string;
  proxied: boolean;
  ttl: number;
};

const token = process.env.CLOUDFLARE_API_TOKEN;
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const target = (process.env.CLOUDFLARE_DNS_TARGET || DEFAULT_TARGET).trim();
const apex = (process.env.DNS_APEX || DEFAULT_APEX).trim().toLowerCase();
const domainsFile = process.env.DOMAINS_FILE || DEFAULT_DOMAINS_FILE;
const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

function fail(message: string): never {
  console.error(`[cloudflare-dns-sync] ERROR: ${message}`);
  process.exit(1);
}

if (!token) fail("CLOUDFLARE_API_TOKEN is required");
if (!zoneId) fail("CLOUDFLARE_ZONE_ID is required");
if (!target) fail("CLOUDFLARE_DNS_TARGET resolved to an empty string");
if (!apex) fail("DNS_APEX resolved to an empty string");

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Small wrapper around fetch that adds auth, parses the Cloudflare envelope,
// retries on 429/5xx with backoff, and throws with a clear message otherwise.
async function cfFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<CloudflareResponse<T>> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      // Network-level failure: back off and retry.
      lastErr = err;
      const wait = 500 * 2 ** attempt;
      console.warn(
        `[cloudflare-dns-sync] network error on ${init.method ?? "GET"} ${path}; retrying in ${wait}ms`,
      );
      await sleep(wait);
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** attempt;
      console.warn(
        `[cloudflare-dns-sync] ${res.status} on ${init.method ?? "GET"} ${path}; retrying in ${wait}ms`,
      );
      await sleep(wait);
      continue;
    }

    let body: CloudflareResponse<T>;
    try {
      body = (await res.json()) as CloudflareResponse<T>;
    } catch (err) {
      throw new Error(
        `Failed to parse Cloudflare response (${res.status}) for ${path}: ${String(err)}`,
      );
    }

    if (!res.ok || !body.success) {
      const detail = (body.errors ?? [])
        .map((e) => `${e.code}: ${e.message}`)
        .join("; ");
      throw new Error(
        `Cloudflare API ${res.status} on ${init.method ?? "GET"} ${path}: ${detail || res.statusText}`,
      );
    }

    return body;
  }

  throw new Error(
    `Cloudflare API exhausted ${MAX_RETRIES} retries for ${path}: ${String(lastErr)}`,
  );
}

// Reads domains.json and returns the fully-qualified hostnames to sync for the
// configured apex. Always includes the apex itself.
function loadDesiredHostnames(): string[] {
  const path = resolve(domainsFile);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    fail(`Could not read domains file at ${path}: ${String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`domains.json is not valid JSON: ${String(err)}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail('domains.json must be an object of shape { "apex": ["slug", ...] }');
  }

  const map = parsed as Record<string, unknown>;
  const slugsRaw = map[apex];
  if (slugsRaw === undefined) {
    fail(
      `domains.json has no entry for apex "${apex}" (keys: ${Object.keys(map).join(", ") || "none"})`,
    );
  }
  if (!Array.isArray(slugsRaw)) {
    fail(`domains.json entry for "${apex}" must be an array of slug strings`);
  }

  const hostnames = new Set<string>();
  hostnames.add(apex); // apex CNAME (flattened)

  for (const slug of slugsRaw) {
    if (typeof slug !== "string" || !slug.trim()) continue;
    const clean = slug.trim().toLowerCase();
    // A slug may be a bare label ("core") or already-qualified
    // ("core.vorinthex.com"); normalise to the FQDN either way.
    const host = clean.endsWith(`.${apex}`) || clean === apex
      ? clean
      : `${clean}.${apex}`;
    hostnames.add(host);
  }

  return [...hostnames];
}

// Fetch every DNS record in the zone, following pagination.
async function listAllRecords(): Promise<DnsRecord[]> {
  const records: DnsRecord[] = [];
  const perPage = 100;
  let page = 1;

  for (;;) {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });
    const body = await cfFetch<DnsRecord[]>(
      `/zones/${zoneId}/dns_records?${params.toString()}`,
    );
    records.push(...body.result);

    const info = body.result_info;
    if (!info || page >= info.total_pages || body.result.length === 0) break;
    page += 1;
  }

  return records;
}

function needsUpdate(existing: DnsRecord, desired: DesiredRecord): boolean {
  return (
    existing.type !== desired.type ||
    existing.content !== desired.content ||
    existing.proxied !== desired.proxied
  );
}

async function main() {
  console.log(
    `[cloudflare-dns-sync] apex=${apex} target=${target} dryRun=${dryRun}`,
  );

  const hostnames = loadDesiredHostnames();
  const desired: DesiredRecord[] = hostnames.map((name) => ({
    name,
    type: "CNAME",
    content: target,
    proxied: true,
    ttl: 1, // "automatic"; required to be 1 for proxied records
  }));

  console.log(
    `[cloudflare-dns-sync] desired records: ${desired.length} (${hostnames.join(", ")})`,
  );

  const existing = await listAllRecords();
  // Index by "name|TYPE" so we match on name+type and can detect duplicates.
  const byKey = new Map<string, DnsRecord[]>();
  for (const rec of existing) {
    const key = `${rec.name.toLowerCase()}|${rec.type.toUpperCase()}`;
    const list = byKey.get(key) ?? [];
    list.push(rec);
    byKey.set(key, list);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let failures = 0;

  for (const want of desired) {
    // A proxied hostname may already exist as a CNAME (our own record) or as
    // an A/AAAA record from earlier infra. We only manage CNAMEs; match by
    // name+type=CNAME to stay idempotent and never duplicate.
    const key = `${want.name.toLowerCase()}|CNAME`;
    const matches = byKey.get(key) ?? [];

    if (matches.length === 0) {
      // Also warn if a non-CNAME record shadows this name; we do not touch it,
      // but the operator should know Cloudflare will reject a conflicting CNAME.
      const shadow = existing.filter(
        (r) => r.name.toLowerCase() === want.name.toLowerCase() && r.type.toUpperCase() !== "CNAME",
      );
      if (shadow.length > 0) {
        console.warn(
          `[cloudflare-dns-sync] WARN: ${want.name} already has ${shadow
            .map((s) => s.type)
            .join("/")} record(s); creating a CNAME may conflict`,
        );
      }

      if (dryRun) {
        console.log(`[plan] CREATE CNAME ${want.name} -> ${want.content} (proxied)`);
        created += 1;
        continue;
      }
      try {
        await cfFetch<DnsRecord>(`/zones/${zoneId}/dns_records`, {
          method: "POST",
          body: JSON.stringify(want),
        });
        console.log(`[create] CNAME ${want.name} -> ${want.content} (proxied)`);
        created += 1;
      } catch (err) {
        console.error(`[cloudflare-dns-sync] failed to create ${want.name}: ${String(err)}`);
        failures += 1;
      }
      continue;
    }

    // Keep the first match as canonical; report extras as duplicates but do
    // NOT delete them automatically (destructive) — surface them instead.
    const [canonical, ...extras] = matches;
    if (extras.length > 0) {
      console.warn(
        `[cloudflare-dns-sync] WARN: ${want.name} has ${matches.length} CNAME records; managing ${canonical.id}, leaving ${extras.length} extra untouched`,
      );
    }

    if (!needsUpdate(canonical, want)) {
      console.log(`[unchanged] CNAME ${want.name} -> ${want.content}`);
      unchanged += 1;
      continue;
    }

    if (dryRun) {
      console.log(
        `[plan] UPDATE CNAME ${want.name}: ${canonical.content}${canonical.proxied ? " (proxied)" : ""} -> ${want.content} (proxied)`,
      );
      updated += 1;
      continue;
    }
    try {
      await cfFetch<DnsRecord>(`/zones/${zoneId}/dns_records/${canonical.id}`, {
        method: "PUT",
        body: JSON.stringify(want),
      });
      console.log(`[update] CNAME ${want.name} -> ${want.content} (proxied)`);
      updated += 1;
    } catch (err) {
      console.error(`[cloudflare-dns-sync] failed to update ${want.name}: ${String(err)}`);
      failures += 1;
    }
  }

  console.log(
    `[cloudflare-dns-sync] summary: created=${created} updated=${updated} unchanged=${unchanged} failures=${failures}${dryRun ? " (dry-run, no changes applied)" : ""}`,
  );

  if (failures > 0) {
    fail(`${failures} record operation(s) failed`);
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
