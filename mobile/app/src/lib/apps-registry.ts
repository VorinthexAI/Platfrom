import { z } from "zod";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://vorinthex.com";
const BACKEND_API_KEY = process.env.EXPO_PUBLIC_BACKEND_API_KEY ?? "";

export const CANONICAL_APP_SLUGS = [
  "vorinthex-ai",
  "archive",
  "gallery",
  "compass",
  "signal",
  "ascend",
  "core",
] as const;

export const serverAppSchema = z.strictObject({
  key: z.string().cuid(),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(300),
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

export function appsBootstrapHeaders(): Record<string, string> {
  return BACKEND_API_KEY ? { "X-Vorinthex-API-Key": BACKEND_API_KEY } : {};
}

export async function fetchAppsRegistry(): Promise<ServerApp[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/api/v1/apps`, {
      headers: appsBootstrapHeaders(),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`App registry request failed with status ${response.status}.`);
    return parseAppsRegistry(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}
