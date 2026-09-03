import { Redirect, Slot, useLocalSearchParams } from "expo-router";
import { useLayoutEffect } from "react";

import { capabilitySlugSchema } from "@/data/registry";
import { useAppsStore } from "@/state/apps";

export default function CapabilityLayout() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const parsed = capabilitySlugSchema.safeParse(slug);
  const routeSlug = parsed.success ? parsed.data : null;
  const workspaceSelection = useAppsStore((state) => state.workspaceSelection);
  const enterWorkspace = useAppsStore((state) => state.enterWorkspace);

  useLayoutEffect(() => {
    if (!routeSlug) return;
    enterWorkspace(routeSlug);
  }, [enterWorkspace, routeSlug]);

  if (!routeSlug) return <Redirect href="/capability/archive" />;
  if (workspaceSelection !== routeSlug) return null;
  return <Slot />;
}
