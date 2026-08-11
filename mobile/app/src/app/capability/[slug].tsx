import { Redirect, useLocalSearchParams } from "expo-router";
import type { ComponentType } from "react";

import { AscendContent } from "@/components/capability/AscendContent";
import { CapabilityShell } from "@/components/capability/CapabilityShell";
import { CompassContent } from "@/components/capability/CompassContent";
import { GalleryWorkspace } from "@/components/capability/GalleryWorkspace";
import { KnowledgeWorkspace } from "@/components/capability/KnowledgeWorkspace";
import { SignalContent } from "@/components/capability/SignalContent";
import { capabilitySlugSchema, getCapability, type CapabilitySlug } from "@/data/registry";

const CONTENT_BY_SLUG: Record<Exclude<CapabilitySlug, "archive" | "gallery">, ComponentType> = {
  signal: SignalContent,
  compass: CompassContent,
  ascend: AscendContent,
};

export default function CapabilityRoute() {
  const params = useLocalSearchParams<{ slug: string }>();
  const parsed = capabilitySlugSchema.safeParse(params.slug);

  if (!parsed.success) {
    return <Redirect href="/capability/archive" />;
  }

  const capability = getCapability(parsed.data);
  if (parsed.data === "archive") return <KnowledgeWorkspace />;
  if (parsed.data === "gallery") return <GalleryWorkspace />;
  const Content = CONTENT_BY_SLUG[parsed.data];

  return (
    <CapabilityShell capability={capability}>
      <Content />
    </CapabilityShell>
  );
}
