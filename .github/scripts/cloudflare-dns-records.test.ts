import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { desiredDnsRecords } from "./cloudflare-dns-records";

test("generated production hostnames keep only the API DNS-only", () => {
  const domains = JSON.parse(readFileSync(new URL("./domains.json", import.meta.url), "utf8")) as Record<string, string[]>;
  const apex = "vorinthex.com";
  const records = desiredDnsRecords([apex, ...domains[apex].map((label) => `${label}.${apex}`)], "origin.example.com", apex, "192.0.2.8");

  expect(records).toContainEqual({ name: `api.${apex}`, type: "A", content: "192.0.2.8", proxied: false, ttl: 300 });
  expect(records.filter((record) => record.proxied).map((record) => record.name)).toEqual([apex, `www.${apex}`]);
});
