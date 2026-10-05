import type { HealthResponse } from "./product-client";

export function shouldPromptForAppUpdate(installedVersion: string | undefined, availableVersion: string | undefined, dismissedVersion: string | null): boolean {
  if (!installedVersion || !availableVersion || availableVersion === dismissedVersion) return false;
  if (!/^\d+\.\d+\.\d+$/.test(installedVersion) || !/^\d+\.\d+\.\d+$/.test(availableVersion)) return false;
  const installed = installedVersion.split(".").map(Number);
  const available = availableVersion.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (available[index]! !== installed[index]!) return available[index]! > installed[index]!;
  }
  return false;
}

export function appStoreUrl(platform: string, health: HealthResponse): string | null {
  return platform === "android" ? health.playStoreUrl : health.appStoreUrl;
}
