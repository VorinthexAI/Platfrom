import { beforeEach, describe, expect, test } from "bun:test";

import { CANONICAL_APP_SLUGS, parseAppsRegistry } from "./apps-registry";
import { selectedAppKeyHeaders } from "./app-request-headers";
import { useAppsStore } from "@/state/apps";

const timestamp = "2026-09-03T12:00:00.000Z";

function app(slug: string, index: number) {
  return {
    key: `ck${String(index).padStart(23, "0")}`,
    slug,
    name: `${slug} name`,
    description: `${slug} description`,
    version: "1.0.0",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function response(extra: ReturnType<typeof app>[] = []) {
  return { apps: [...CANONICAL_APP_SLUGS.map(app), ...extra] };
}

function mockResponse(body: unknown) {
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => body })) as typeof fetch;
}

describe("apps registry parsing", () => {
  test("strictly parses all canonical apps while retaining unknown server apps", () => {
    const parsed = parseAppsRegistry(response([app("future-app", 8)]));
    expect(parsed).toHaveLength(8);
    expect(parsed.at(-1)?.slug).toBe("future-app");
    expect(() => parseAppsRegistry({ ...response(), unexpected: true })).toThrow();
    expect(() => parseAppsRegistry({ apps: response().apps.map((entry, index) => index ? entry : { ...entry, unexpected: true }) })).toThrow();
    expect(() => parseAppsRegistry({ apps: response().apps.map((entry, index) => index ? entry : { ...entry, key: "not-a-cuid" }) })).toThrow();
    expect(() => parseAppsRegistry({ apps: response().apps.map((entry, index) => index ? entry : { ...entry, updatedAt: "yesterday" }) })).toThrow();
  });

  test("rejects duplicate keys, duplicate slugs, and missing canonical rows", () => {
    const rows = response().apps;
    expect(() => parseAppsRegistry({ apps: [...rows, { ...app("future-app", 8), key: rows[0]!.key }] })).toThrow(/Duplicate app key/);
    expect(() => parseAppsRegistry({ apps: [...rows, { ...app("archive", 8) }] })).toThrow(/Duplicate app slug/);
    expect(() => parseAppsRegistry({ apps: rows.filter(({ slug }) => slug !== "core") })).toThrow(/Missing canonical app: core/);
  });
});

describe("apps registry state", () => {
  beforeEach(() => {
    useAppsStore.setState({
      apps: [],
      bootstrapStatus: "idle",
      bootstrapError: null,
      selectedApp: null,
      currentAppKey: null,
      workspaceSelection: null,
    });
  });

  test("tracks bootstrap progress and initially selects Core", async () => {
    let release!: (value: { ok: true; status: number; json: () => Promise<unknown> }) => void;
    globalThis.fetch = (() => new Promise((resolve) => { release = resolve; })) as typeof fetch;
    const bootstrapping = useAppsStore.getState().bootstrap();
    expect(useAppsStore.getState().bootstrapStatus).toBe("bootstrapping");
    release({ ok: true, status: 200, json: async () => response([app("future-app", 8)]) });
    await bootstrapping;
    expect(useAppsStore.getState()).toMatchObject({
      bootstrapStatus: "ready",
      currentAppKey: app("core", 6).key,
      selectedApp: { slug: "core" },
    });
    expect(useAppsStore.getState().apps.some(({ slug }) => slug === "future-app")).toBe(true);
  });

  test("fails bootstrap on an invalid registry and can retry", async () => {
    mockResponse({ apps: response().apps.filter(({ slug }) => slug !== "signal") });
    await useAppsStore.getState().bootstrap();
    expect(useAppsStore.getState()).toMatchObject({ bootstrapStatus: "failed", currentAppKey: null });
    mockResponse(response());
    await useAppsStore.getState().bootstrap();
    expect(useAppsStore.getState().bootstrapStatus).toBe("ready");
  });

  test("synchronously selects workspaces and restores them after Core", async () => {
    mockResponse(response());
    await useAppsStore.getState().bootstrap();
    useAppsStore.getState().leaveCore();
    expect(useAppsStore.getState()).toMatchObject({ selectedApp: { slug: "core" }, workspaceSelection: null });
    useAppsStore.getState().enterWorkspace("gallery");
    expect(useAppsStore.getState()).toMatchObject({ selectedApp: { slug: "gallery" }, currentAppKey: app("gallery", 2).key, workspaceSelection: "gallery" });
    useAppsStore.getState().enterCore();
    expect(useAppsStore.getState()).toMatchObject({ selectedApp: { slug: "core" }, currentAppKey: app("core", 6).key, workspaceSelection: "gallery" });
    useAppsStore.getState().leaveCore();
    expect(useAppsStore.getState()).toMatchObject({ selectedApp: { slug: "gallery" }, currentAppKey: app("gallery", 2).key, workspaceSelection: "gallery" });
  });

  test("exposes only the exact selected app key header for transports", async () => {
    expect(() => selectedAppKeyHeaders()).toThrow("No app is selected");
    mockResponse(response());
    await useAppsStore.getState().bootstrap();
    expect(selectedAppKeyHeaders()).toEqual({ "X-Vorinthex-App-Key": app("core", 6).key });
    expect(selectedAppKeyHeaders()).not.toHaveProperty("X-Vorinthex-Domain");
  });
});
