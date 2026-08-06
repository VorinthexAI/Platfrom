#!/usr/bin/env bun
/**
 * Generates the single public Vorinthex hostname.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const domains = {
  "vorinthex.com": [],
};

const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "domains.json");
writeFileSync(outPath, `${JSON.stringify(domains, null, 2)}\n`, "utf8");

console.log(`Wrote ${outPath}`);
console.log("Domains: 1, subdomain slugs: 0");
