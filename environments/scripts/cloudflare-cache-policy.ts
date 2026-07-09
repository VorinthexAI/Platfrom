#!/usr/bin/env bun
// Keep Cloudflare from serving stale application shells during rapid launches.
//
// This script intentionally sets Browser Cache TTL to Cloudflare's minimum
// supported value (1 second) and purges edge cache. The app origin still sends
// Cache-Control: no-store, which is the important part for HTML/app responses.

const API_BASE = "https://api.cloudflare.com/client/v4";
const MAX_RETRIES = 5;

type CloudflareError = { code: number; message: string };

type CloudflareResponse<T> = {
  success: boolean;
  errors: CloudflareError[];
  messages: unknown[];
  result: T;
};

const token = process.env.CLOUDFLARE_API_TOKEN;
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

function fail(message: string): never {
  console.error(`[cloudflare-cache-policy] ERROR: ${message}`);
  process.exit(1);
}

if (!token) fail("CLOUDFLARE_API_TOKEN is required");
if (!zoneId) fail("CLOUDFLARE_ZONE_ID is required");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      lastErr = err;
      const wait = 500 * 2 ** attempt;
      console.warn(
        `[cloudflare-cache-policy] network error on ${init.method ?? "GET"} ${path}; retrying in ${wait}ms`,
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
        `[cloudflare-cache-policy] ${res.status} on ${init.method ?? "GET"} ${path}; retrying in ${wait}ms`,
      );
      await sleep(wait);
      continue;
    }

    const body = (await res.json()) as CloudflareResponse<T>;
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

async function main() {
  console.log(`[cloudflare-cache-policy] dryRun=${dryRun}`);
  console.log(
    "[cloudflare-cache-policy] Browser Cache TTL target: 1 second (Cloudflare minimum)",
  );

  if (dryRun) {
    console.log("[plan] PATCH zone setting browser_cache_ttl -> 1");
    console.log("[plan] PURGE everything");
    return;
  }

  try {
    await cfFetch(`/zones/${zoneId}/settings/browser_cache_ttl`, {
      method: "PATCH",
      body: JSON.stringify({ value: 1 }),
    });
    console.log("[update] browser_cache_ttl=1");
  } catch (err) {
    console.warn(
      `[cloudflare-cache-policy] WARN: could not update browser_cache_ttl: ${String(err)}`,
    );
  }

  try {
    await cfFetch(`/zones/${zoneId}/purge_cache`, {
      method: "POST",
      body: JSON.stringify({ purge_everything: true }),
    });
    console.log("[purge] everything");
  } catch (err) {
    console.warn(
      `[cloudflare-cache-policy] WARN: could not purge cache: ${String(err)}`,
    );
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
