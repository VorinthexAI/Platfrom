export const APP_STORE_URL = "https://apps.apple.com/us/search?term=Vorinthex%20AI";
export const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=app.vorinthex.com";

export function shouldPromptForAppUpdate(installedVersion: string | undefined, registryVersion: string | undefined, dismissedVersion: string | null): boolean {
  return Boolean(installedVersion && registryVersion && installedVersion !== registryVersion && registryVersion !== dismissedVersion);
}

export function appStoreUrl(platform: string): string {
  return platform === "android" ? GOOGLE_PLAY_URL : APP_STORE_URL;
}
