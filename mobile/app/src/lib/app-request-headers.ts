import { useAppsStore } from "@/state/apps";

export const VORINTHEX_APP_KEY_HEADER = "X-Vorinthex-App-Key";

export function appKeyHeaders(appKey: string): Record<typeof VORINTHEX_APP_KEY_HEADER, string> {
  return { [VORINTHEX_APP_KEY_HEADER]: appKey };
}

export function selectedAppKeyHeaders(): Record<typeof VORINTHEX_APP_KEY_HEADER, string> {
  const key = useAppsStore.getState().currentAppKey;
  if (!key) throw new Error("No app is selected.");
  return appKeyHeaders(key);
}
