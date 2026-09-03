import { useAppsStore } from "@/state/apps";

export const VORINTHEX_APP_KEY_HEADER = "X-Vorinthex-App-Key";

export function selectedAppKeyHeaders(): Record<typeof VORINTHEX_APP_KEY_HEADER, string> {
  const key = useAppsStore.getState().currentAppKey;
  if (!key) throw new Error("No app is selected.");
  return { [VORINTHEX_APP_KEY_HEADER]: key };
}
