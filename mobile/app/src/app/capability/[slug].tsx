import { Redirect, useLocalSearchParams } from "expo-router";

import { AscendWorkspace } from "@/components/capability/AscendWorkspace";
import { GalleryWorkspace } from "@/components/capability/GalleryWorkspace";
import { KnowledgeWorkspace } from "@/components/capability/KnowledgeWorkspace";
import { EmailWorkspace } from "@/components/capability/EmailWorkspace";
import { TravelWorkspace } from "@/components/capability/TravelWorkspace";
import { capabilitySlugSchema } from "@/data/registry";

export default function CapabilityRoute() {
  const params = useLocalSearchParams<{ slug: string }>();
  const parsed = capabilitySlugSchema.safeParse(params.slug);

  if (!parsed.success) {
    return <Redirect href="/capability/archive" />;
  }

  if (parsed.data === "archive") return <KnowledgeWorkspace />;
  if (parsed.data === "gallery") return <GalleryWorkspace />;
  if (parsed.data === "compass") return <TravelWorkspace />;
  if (parsed.data === "signal") return <EmailWorkspace />;
  return <AscendWorkspace />;
}
