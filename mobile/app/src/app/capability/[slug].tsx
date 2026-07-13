import { Redirect, useLocalSearchParams } from "expo-router";
import type { ComponentType } from "react";

import { ArchiveContent } from "@/components/capability/ArchiveContent";
import { AscendContent } from "@/components/capability/AscendContent";
import { CapabilityShell } from "@/components/capability/CapabilityShell";
import { CompassContent } from "@/components/capability/CompassContent";
import { GalleryContent } from "@/components/capability/GalleryContent";
import { SignalContent } from "@/components/capability/SignalContent";
import { capabilitySlugSchema, getCapability, type CapabilitySlug } from "@/data/registry";

const CONTENT_BY_SLUG: Record<CapabilitySlug, ComponentType> = {
  archive: ArchiveContent,
  gallery: GalleryContent,
  signal: SignalContent,
  compass: CompassContent,
  ascend: AscendContent,
};

export default function CapabilityRoute() {
  const params = useLocalSearchParams<{ slug: string }>();
  const parsed = capabilitySlugSchema.safeParse(params.slug);

  if (!parsed.success) {
    return <Redirect href="/brain" />;
  }

  const capability = getCapability(parsed.data);
  const Content = CONTENT_BY_SLUG[parsed.data];

  return (
    <CapabilityShell capability={capability}>
      <Content />
    </CapabilityShell>
  );
}
