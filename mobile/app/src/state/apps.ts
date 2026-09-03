import { create } from "zustand";

import type { CapabilitySlug } from "@/data/registry";
import { fetchAppsRegistry, type ServerApp } from "@/lib/apps-registry";

export type AppBootstrapStatus = "idle" | "bootstrapping" | "ready" | "failed";

type AppsState = {
  apps: ServerApp[];
  bootstrapStatus: AppBootstrapStatus;
  bootstrapError: string | null;
  selectedApp: ServerApp | null;
  currentAppKey: string | null;
  workspaceSelection: CapabilitySlug | null;
  bootstrap: () => Promise<void>;
  enterWorkspace: (slug: CapabilitySlug) => void;
  enterCore: () => void;
  leaveCore: () => void;
};

let bootstrapPromise: Promise<void> | null = null;

function appForSlug(apps: ServerApp[], slug: string): ServerApp {
  const app = apps.find((candidate) => candidate.slug === slug);
  if (!app) throw new Error(`App registry has no app for ${slug}.`);
  return app;
}

function selectedAppState(app: ServerApp) {
  return { selectedApp: app, currentAppKey: app.key };
}

export const useAppsStore = create<AppsState>((set, get) => ({
  apps: [],
  bootstrapStatus: "idle",
  bootstrapError: null,
  selectedApp: null,
  currentAppKey: null,
  workspaceSelection: null,
  bootstrap: () => {
    if (get().bootstrapStatus === "ready") return Promise.resolve();
    if (bootstrapPromise) return bootstrapPromise;
    set({ bootstrapStatus: "bootstrapping", bootstrapError: null });
    bootstrapPromise = fetchAppsRegistry()
      .then((apps) => {
        const core = appForSlug(apps, "core");
        set({ apps, bootstrapStatus: "ready", bootstrapError: null, ...selectedAppState(core) });
      })
      .catch((error: unknown) => {
        set({ bootstrapStatus: "failed", bootstrapError: error instanceof Error ? error.message : "App registry bootstrap failed." });
      })
      .finally(() => {
        bootstrapPromise = null;
      });
    return bootstrapPromise;
  },
  enterWorkspace: (slug) => set((state) => ({
    ...selectedAppState(appForSlug(state.apps, slug)),
    workspaceSelection: slug,
  })),
  enterCore: () => set((state) => selectedAppState(appForSlug(state.apps, "core"))),
  leaveCore: () => set((state) => selectedAppState(appForSlug(state.apps, state.workspaceSelection ?? "core"))),
}));

export async function ensureAppsReady(): Promise<string> {
  if (!useAppsStore.getState().currentAppKey) await useAppsStore.getState().bootstrap();
  const key = useAppsStore.getState().currentAppKey;
  if (!key) throw new Error(useAppsStore.getState().bootstrapError ?? "App registry is unavailable.");
  return key;
}
