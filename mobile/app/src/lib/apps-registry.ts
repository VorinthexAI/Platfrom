import { z } from "zod";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://vorinthex.com";
const BACKEND_API_KEY = process.env.EXPO_PUBLIC_BACKEND_API_KEY ?? "";
type RequestIdentityHeadersProvider = () => Record<string, string> | Promise<Record<string, string>>;

let requestIdentityHeaders: RequestIdentityHeadersProvider = async () => {
  const [{ getInstallationEventIdentifier, INSTALLATION_EVENT_IDENTIFIER_HEADER }, { getDeviceIdentifier, DEVICE_IDENTIFIER_HEADER }] = await Promise.all([
    import("./installation-event-identifier-vault"),
    import("./device-identifier-vault"),
  ]);
  const [eventIdentifier, device] = await Promise.all([getInstallationEventIdentifier(), getDeviceIdentifier()]);
  return {
    [INSTALLATION_EVENT_IDENTIFIER_HEADER]: eventIdentifier,
    ...(device ? { [DEVICE_IDENTIFIER_HEADER]: device } : {}),
  };
};

export const CANONICAL_APP_SLUGS = [
  "core",
] as const;

export const serverAppSchema = z.strictObject({
  key: z.string().cuid(),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(300),
  detailedDescription: z.string().trim().min(1).max(5_000),
  logoUrl: z.url(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type ServerApp = z.infer<typeof serverAppSchema>;

export const appsRegistryResponseSchema = z.strictObject({
  apps: z.array(serverAppSchema),
}).superRefine(({ apps }, context) => {
  const keys = new Set<string>();
  const slugs = new Set<string>();
  for (const app of apps) {
    if (keys.has(app.key)) context.addIssue({ code: "custom", message: `Duplicate app key: ${app.key}`, path: ["apps"] });
    if (slugs.has(app.slug)) context.addIssue({ code: "custom", message: `Duplicate app slug: ${app.slug}`, path: ["apps"] });
    keys.add(app.key);
    slugs.add(app.slug);
  }
  for (const slug of CANONICAL_APP_SLUGS) {
    if (!slugs.has(slug)) context.addIssue({ code: "custom", message: `Missing canonical app: ${slug}`, path: ["apps"] });
  }
});

export function parseAppsRegistry(input: unknown): ServerApp[] {
  return appsRegistryResponseSchema.parse(input).apps;
}

export async function appsBootstrapHeaders(): Promise<Record<string, string>> {
  return {
    ...await requestIdentityHeaders(),
    ...(BACKEND_API_KEY ? { "X-Vorinthex-API-Key": BACKEND_API_KEY } : {}),
  };
}

export function configureAppsBootstrapIdentityHeaders(provider: RequestIdentityHeadersProvider) {
  requestIdentityHeaders = provider;
}

export const agentsRegistryResponseSchema = z.strictObject({
  agents: z.array(serverAppSchema),
}).superRefine(({ agents }, context) => {
  const keys = new Set<string>();
  const slugs = new Set<string>();
  for (const agent of agents) {
    if (keys.has(agent.key)) context.addIssue({ code: "custom", message: `Duplicate agent key: ${agent.key}`, path: ["agents"] });
    if (slugs.has(agent.slug)) context.addIssue({ code: "custom", message: `Duplicate agent slug: ${agent.slug}`, path: ["agents"] });
    keys.add(agent.key);
    slugs.add(agent.slug);
  }
  for (const slug of CANONICAL_APP_SLUGS) {
    if (!slugs.has(slug)) context.addIssue({ code: "custom", message: `Missing canonical agent: ${slug}`, path: ["agents"] });
  }
});

export function parseAgentsRegistry(input: unknown): ServerApp[] {
  return agentsRegistryResponseSchema.parse(input).agents;
}

export async function fetchAppsRegistry(): Promise<ServerApp[]> {
  return fetchAgentsRegistry();
}

export async function fetchAgentsRegistry(): Promise<ServerApp[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/api/v1/agents`, {
      headers: await appsBootstrapHeaders(),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Agent registry request failed with status ${response.status}.`);
    return parseAgentsRegistry(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}
