import { describe, expect, test } from "bun:test";
import { getPermanentRedirects, getSecurityHeaders } from "../../next.config";
import manifest from "@/app/manifest";
import sitemap from "@/app/sitemap";
import {
  CANONICAL_ORIGIN,
  CORE_FAQ,
  PUBLIC_ROUTES,
  canonicalUrl,
} from "@/lib/discoverability";
import { buildLlmsFullText, buildLlmsText } from "@/lib/llms";
import { buildRobotsMetadata, buildRouteMetadata } from "@/lib/metadata";
import {
  NEWCOMER_FREE_SPARKS,
  SPARK_MONTHLY_PLANS,
  SPARK_TOP_UPS,
  formatSparkCount,
  formatUsd,
} from "@/lib/spark-pricing";
import { buildGlobalGraph, buildPageGraph } from "@/lib/structured-data";

describe("public discoverability registry", () => {
  test("has unique canonical paths and URLs", () => {
    const paths = PUBLIC_ROUTES.map(({ path }) => path);
    const urls = paths.map(canonicalUrl);

    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.every((url) => url.startsWith(CANONICAL_ORIGIN))).toBe(true);
  });

  test("keeps metadata and Open Graph content route-specific", () => {
    for (const route of PUBLIC_ROUTES) {
      const metadata = buildRouteMetadata(route.path);

      expect(metadata.title).toEqual({ absolute: route.title });
      expect(metadata.description).toBe(route.description);
      expect(metadata.alternates?.canonical).toBe(canonicalUrl(route.path));
      expect(metadata.openGraph?.title).toBe(route.title);
      expect(metadata.openGraph?.description).toBe(route.description);
      expect(metadata.openGraph?.url).toBe(canonicalUrl(route.path));
      expect(metadata.twitter?.title).toBe(route.title);
      expect(metadata.twitter?.description).toBe(route.description);
      expect(metadata.openGraph?.images).toEqual([
        expect.objectContaining({ width: 1200, height: 630, alt: expect.any(String) }),
      ]);
      expect(metadata.twitter?.images).toEqual([
        expect.objectContaining({ width: 1200, height: 630, alt: expect.any(String) }),
      ]);
      expect(metadata.robots).toBeUndefined();
    }
  });

  test("covers exactly the canonical routes in the sitemap", () => {
    expect(sitemap().map(({ url }) => url).sort()).toEqual(
      PUBLIC_ROUTES.map(({ path }) => canonicalUrl(path)).sort(),
    );
    expect(sitemap().every(({ lastModified }) => lastModified === "2026-08-06")).toBe(
      true,
    );
  });

  test("keeps the install manifest aligned with pre-launch facts", () => {
    const output = manifest();

    expect(output.id).toBe("/");
    expect(output.scope).toBe("/");
    expect(output.description).toContain("pre-launch");
    expect(output.description).toContain("not yet available");
  });
});

describe("structured data", () => {
  test("uses unique IDs and resolves every graph reference", () => {
    for (const route of PUBLIC_ROUTES) {
      const nodes = [
        ...buildGlobalGraph()["@graph"],
        ...buildPageGraph(route.path)["@graph"],
      ] as Record<string, unknown>[];
      const ids = nodes.map((node) => node["@id"] as string);
      const references: string[] = [];

      const visit = (value: unknown) => {
        if (Array.isArray(value)) {
          value.forEach(visit);
        } else if (value && typeof value === "object") {
          const object = value as Record<string, unknown>;
          if (Object.keys(object).length === 1 && typeof object["@id"] === "string") {
            references.push(object["@id"]);
          }
          Object.values(object).forEach(visit);
        }
      };

      nodes.forEach(visit);
      expect(new Set(ids).size).toBe(ids.length);
      expect(references.every((reference) => ids.includes(reference))).toBe(true);
    }
  });

  test("places product and FAQ schema only on home and emits no hidden breadcrumbs", () => {
    expect(buildPageGraph("/")["@graph"].map((node) => node["@type"])).toContain(
      "SoftwareApplication",
    );
    expect(buildPageGraph("/")["@graph"].map((node) => node["@type"])).toContain(
      "FAQPage",
    );

    for (const route of PUBLIC_ROUTES.filter(({ path }) => path !== "/")) {
      const types = buildPageGraph(route.path)["@graph"].map(
        (node) => node["@type"],
      );
      expect(types).not.toContain("SoftwareApplication");
      expect(types).not.toContain("FAQPage");
      expect(types).not.toContain("BreadcrumbList");
    }
  });
});

describe("generated answer-engine content", () => {
  test("states pre-launch facts consistently and links canonical evidence", () => {
    const outputs = [buildLlmsText(), buildLlmsFullText()];

    for (const output of outputs) {
      expect(output).toContain("# Vorinthex AI");
      expect(output).toContain("> ");
      expect(output).toContain("Last reviewed: 2026-08-06");
      expect(output).toContain("pre-launch");
      expect(output).toContain("purchases are not currently available");
      expect(output).toContain(canonicalUrl("/terms"));
      expect(output).not.toMatch(/unlimited|most popular|app store|google play/i);
      expect(output).toContain(formatSparkCount(NEWCOMER_FREE_SPARKS));

      for (const plan of SPARK_MONTHLY_PLANS) {
        expect(output).toContain(plan.name);
        expect(output).toContain(formatSparkCount(plan.sparks));
        expect(output).toContain(formatUsd(plan.price));
      }

      for (const topUp of SPARK_TOP_UPS) {
        expect(output).toContain(formatSparkCount(topUp.sparks));
        expect(output).toContain(formatUsd(topUp.price));
      }
    }

    for (const { question, answer } of CORE_FAQ) {
      expect(buildLlmsFullText()).toContain(question);
      expect(buildLlmsFullText()).toContain(answer);
    }
  });
});

test("retires /core with a permanent redirect to home", () => {
  expect(getPermanentRedirects()).toContainEqual({
    source: "/core",
    destination: "/",
    permanent: true,
  });
});

test("adds a noindex response header only when indexing is blocked", () => {
  expect(getSecurityHeaders(false)).not.toContainEqual({
    key: "X-Robots-Tag",
    value: "noindex, nofollow",
  });
  expect(getSecurityHeaders(true)).toContainEqual({
    key: "X-Robots-Tag",
    value: "noindex, nofollow",
  });
});

test("omits affirmative robots metadata in production", () => {
  expect(buildRobotsMetadata(false)).toEqual({});
  expect(buildRouteMetadata("/", false).robots).toBeUndefined();
  expect(buildRouteMetadata("/", true).robots).toEqual({
    index: false,
    follow: false,
    nocache: true,
  });
});
