const key = /^[A-Za-z0-9_-]{1,160}$/;

const patterns: Array<{ method: "GET" | "POST"; pattern: RegExp }> = [
  { method: "GET", pattern: /^channels$/ },
  { method: "POST", pattern: /^orchestrators\/([A-Za-z0-9_-]{1,160})\/open$/ },
  { method: "GET", pattern: /^channels\/([A-Za-z0-9_-]{1,160})\/messages$/ },
  { method: "POST", pattern: /^channels\/([A-Za-z0-9_-]{1,160})\/messages$/ },
  { method: "POST", pattern: /^channels\/([A-Za-z0-9_-]{1,160})\/messages\/([A-Za-z0-9_-]{1,160})\/reactions$/ },
  { method: "POST", pattern: /^channels\/([A-Za-z0-9_-]{1,160})\/threads$/ },
  { method: "GET", pattern: /^channels\/([A-Za-z0-9_-]{1,160})\/threads\/([A-Za-z0-9_-]{1,160})$/ },
  { method: "POST", pattern: /^channels\/([A-Za-z0-9_-]{1,160})\/threads\/([A-Za-z0-9_-]{1,160})\/replies$/ },
  { method: "POST", pattern: /^channels\/([A-Za-z0-9_-]{1,160})\/threads\/([A-Za-z0-9_-]{1,160})\/resolve$/ },
  { method: "POST", pattern: /^channels\/([A-Za-z0-9_-]{1,160})\/threads\/([A-Za-z0-9_-]{1,160})\/archive$/ },
  { method: "POST", pattern: /^channels\/([A-Za-z0-9_-]{1,160})\/polls$/ },
  { method: "GET", pattern: /^channels\/([A-Za-z0-9_-]{1,160})\/polls\/([A-Za-z0-9_-]{1,160})$/ },
  { method: "POST", pattern: /^channels\/([A-Za-z0-9_-]{1,160})\/polls\/([A-Za-z0-9_-]{1,160})\/votes$/ },
  { method: "POST", pattern: /^channels\/([A-Za-z0-9_-]{1,160})\/polls\/([A-Za-z0-9_-]{1,160})\/close$/ },
];

export function validateChorusProxyPath(method: string, organizationKey: string, segments: string[], searchParams = new URLSearchParams()): string | null {
  if (!key.test(organizationKey) || segments.length === 0 || segments.some((segment) => !key.test(segment))) return null;
  const path = segments.join("/");
  if (!patterns.some((entry) => entry.method === method && entry.pattern.test(path))) return null;
  if (searchParams.size > 0) {
    if (method !== "GET" || !/^channels\/[^/]+\/messages$/.test(path)) return null;
    if ([...searchParams.keys()].some((name) => name !== "limit") || searchParams.getAll("limit").length !== 1 || !/^\d{1,3}$/.test(searchParams.get("limit") ?? "")) return null;
    const limit = Number(searchParams.get("limit"));
    if (limit < 1 || limit > 200) return null;
  }
  return path;
}
