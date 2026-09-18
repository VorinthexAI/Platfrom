import { create } from "zustand";

import type { CapabilitySlug } from "@/data/registry";
import { fetchAppsRegistry, type ServerApp } from "@/lib/apps-registry";
import { fetchSparkCosts, type CapabilitySparkCost, type SparkCharge } from "@/lib/cost-client";
import { fetchPublicBootstrap, type MobileProduct } from "@/lib/product-client";
import { useUiStore } from "./ui";

export type AppBootstrapStatus = "idle" | "bootstrapping" | "ready" | "failed";
export type ProductBootstrapStatus = "idle" | "loading" | "ready" | "unavailable";

type AppsState = {
  apps: ServerApp[];
  products: MobileProduct[];
  sparkCosts: SparkCharge[];
  capabilityCosts: Record<string, CapabilitySparkCost>;
  sparkCostsStatus: ProductBootstrapStatus;
  sparkCostsError: string | null;
  productsStatus: ProductBootstrapStatus;
  productsError: string | null;
  bootstrapStatus: AppBootstrapStatus;
  bootstrapError: string | null;
  selectedApp: ServerApp | null;
  currentAppKey: string | null;
  workspaceSelection: CapabilitySlug | null;
  bootstrap: () => Promise<void>;
  refreshProducts: () => Promise<void>;
  enterWorkspace: (slug: CapabilitySlug) => void;
  enterCore: () => void;
  leaveCore: () => void;
};

let bootstrapPromise: Promise<void> | null = null;
let productsPromise: Promise<void> | null = null;

function refreshProducts(set: (patch: Partial<AppsState>) => void) {
  if (productsPromise) return productsPromise;
  set({ productsStatus: "loading", productsError: null, sparkCostsStatus: "loading", sparkCostsError: null });
  productsPromise = Promise.allSettled([fetchPublicBootstrap(), fetchSparkCosts()])
    .then(([productsResult, costsResult]) => {
      set(productsResult.status === "fulfilled"
        ? { products: productsResult.value, productsStatus: "ready", productsError: null }
        : { products: [], productsStatus: "unavailable", productsError: productsResult.reason instanceof Error ? productsResult.reason.message : "Product catalog is unavailable." });
      set(costsResult.status === "fulfilled"
        ? { capabilityCosts: costsResult.value.capabilityCosts, sparkCosts: costsResult.value.charges, sparkCostsStatus: "ready", sparkCostsError: null }
        : { capabilityCosts: {}, sparkCosts: [], sparkCostsStatus: "unavailable", sparkCostsError: costsResult.reason instanceof Error ? costsResult.reason.message : "Spark costs are unavailable." });
    })
    .finally(() => { productsPromise = null; });
  return productsPromise;
}

const PRIVATE_WORKSPACE_APP: ServerApp = {
  key: "cmtlinos60007w07khqprvt01",
  slug: "hq",
  name: "HQ",
  description: "Your workspace to manage teams and collaboration.",
  detailedDescription: "HQ is your private workspace for managing teams and collaboration.",
  logoUrl: "https://vorinthex.com/logos/entities/product-hq.png",
  version: "1.0.0",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function appForSlug(apps: ServerApp[], slug: string): ServerApp {
  const app = apps.find((candidate) => candidate.slug === slug);
  if (app) return app;
  if (slug === PRIVATE_WORKSPACE_APP.slug) return PRIVATE_WORKSPACE_APP;
  throw new Error(`App registry has no app for ${slug}.`);
}

function selectedAppState(app: ServerApp, previousAppKey: string | null) {
  if (previousAppKey !== app.key) useUiStore.getState().clearSelectedTags();
  return { selectedApp: app, currentAppKey: app.key };
}

export const useAppsStore = create<AppsState>((set, get) => ({
  apps: [],
  products: [],
  sparkCosts: [],
  capabilityCosts: {},
  sparkCostsStatus: "idle",
  sparkCostsError: null,
  productsStatus: "idle",
  productsError: null,
  bootstrapStatus: "idle",
  bootstrapError: null,
  selectedApp: null,
  currentAppKey: null,
  workspaceSelection: null,
  bootstrap: () => {
    if (get().bootstrapStatus === "ready") return Promise.resolve();
    if (bootstrapPromise) return bootstrapPromise;
    set({ bootstrapStatus: "bootstrapping", bootstrapError: null });
    void refreshProducts(set);
    bootstrapPromise = fetchAppsRegistry()
      .then((apps) => {
        const core = appForSlug(apps, "core");
        set({ apps, bootstrapStatus: "ready", bootstrapError: null, ...selectedAppState(core, get().currentAppKey) });
      })
      .catch((error: unknown) => {
        set({ apps: [], selectedApp: null, currentAppKey: null, bootstrapStatus: "failed", bootstrapError: error instanceof Error ? error.message : "App registry bootstrap failed." });
      })
      .finally(() => {
        bootstrapPromise = null;
      });
    return bootstrapPromise;
  },
  refreshProducts: () => refreshProducts(set),
  enterWorkspace: (slug) => set((state) => ({
    ...selectedAppState(appForSlug(state.apps, slug), state.currentAppKey),
    workspaceSelection: slug,
  })),
  enterCore: () => set((state) => selectedAppState(appForSlug(state.apps, "core"), state.currentAppKey)),
  leaveCore: () => set((state) => selectedAppState(appForSlug(state.apps, state.workspaceSelection ?? "core"), state.currentAppKey)),
}));

export async function ensureAppsReady(): Promise<string> {
  if (!useAppsStore.getState().currentAppKey) await useAppsStore.getState().bootstrap();
  const key = useAppsStore.getState().currentAppKey;
  if (!key) throw new Error(useAppsStore.getState().bootstrapError ?? "App registry is unavailable.");
  return key;
}
