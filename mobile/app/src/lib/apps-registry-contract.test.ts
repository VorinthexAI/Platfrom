import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const registry = read("./apps-registry.ts");
const headers = read("./app-request-headers.ts");
const authenticated = read("./api-client.ts");
const publicClient = read("./public-api-client.ts");
const publicStream = read("./public-book-share-stream.ts");
const root = read("../app/_layout.tsx");
const capabilityLayout = read("../app/capability/_layout.tsx");
const switcher = read("../components/capability/WorkspaceAppSwitcher.tsx");

test("the registry bootstrap is direct and omits the selected app header", () => {
  expect(registry).toContain("/api/v1/apps");
  expect(registry).toContain("headers: appsBootstrapHeaders()");
  expect(registry).not.toContain("selectedAppKeyHeaders");
  expect(registry).not.toContain("X-Vorinthex-App-Key");
});

test("every normal native transport injects the exact selected app key header", () => {
  expect(headers).toContain('VORINTHEX_APP_KEY_HEADER = "X-Vorinthex-App-Key"');
  expect(authenticated.match(/selectedAppKeyHeaders\(\)/g)).toHaveLength(2);
  expect(authenticated).toContain("await ensureAppsReady()");
  expect(publicClient.match(/selectedAppKeyHeaders\(\)/g)).toHaveLength(2);
  expect(publicClient).toContain("await ensureAppsReady()");
  expect(publicStream).toContain("Object.entries(publicApiHeaders())");
  for (const source of [headers, authenticated, publicClient, publicStream]) expect(source).not.toContain("X-Vorinthex-Domain");
});

test("root splash gating includes registry readiness and retries failures without onboarding hydration", () => {
  expect(root).toContain("void bootstrapApps();");
  expect(root).toContain('if (appsStatus === "ready") void bootstrap();');
  expect(root).toContain('appsStatus !== "failed"');
  expect(root).toContain("setTimeout(() => void bootstrapApps(), APP_BOOTSTRAP_RETRY_MS)");
  expect(root).toContain('status === "bootstrapping" || appsStatus !== "ready"');
  expect(root).toContain('status !== "bootstrapping" && appsStatus === "ready"');
  expect(root).not.toMatch(/hydrateOnboarding[\s\S]{0,120}return null/);
});

test("the capability layout establishes a supported app before mounting route children", () => {
  expect(capabilityLayout).toContain("capabilitySlugSchema.safeParse(slug)");
  expect(capabilityLayout).toContain("useLayoutEffect");
  expect(capabilityLayout).toContain("enterWorkspace(routeSlug)");
  expect(capabilityLayout).toContain("if (workspaceSelection !== routeSlug) return null");
  expect(capabilityLayout).toContain("return <Slot />");
});

test("the switcher limits routes at compile time and renders only server names", () => {
  expect(switcher).toContain("const AVAILABLE_APP_SLUGS");
  expect(switcher).toContain("state.apps");
  expect(switcher).toContain("serverApp.name");
  expect(switcher).not.toContain("serverApp.description");
  expect(switcher).not.toContain("itemDescription");
  expect(switcher).toContain("enterWorkspace(slug)");
  expect(switcher).not.toContain("onboardingDescription");
  expect(switcher).not.toMatch(/name: "(Archive|Gallery|Compass|Signal|Ascend)"/);
});
