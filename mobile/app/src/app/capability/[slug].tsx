import { Redirect, useLocalSearchParams } from "expo-router";

import { AscendWorkspace } from "@/components/capability/AscendWorkspace";
import { GalleryWorkspace } from "@/components/capability/GalleryWorkspace";
import { KnowledgeWorkspace } from "@/components/capability/KnowledgeWorkspace";
import { EmailWorkspace } from "@/components/capability/EmailWorkspace";
import { TravelWorkspace } from "@/components/capability/TravelWorkspace";
import { capabilitySlugSchema } from "@/data/registry";

export default function CapabilityRoute() {
  const params = useLocalSearchParams<{ slug: string; assetKey?: string; connectorKey?: string; documentKey?: string; returnTripKey?: string; returnTripName?: string; tripKey?: string; openTripAssets?: string }>();
  const parsed = capabilitySlugSchema.safeParse(params.slug);

  if (!parsed.success) {
    return <Redirect href="/capability/archive" />;
  }

  if (parsed.data === "archive") return <KnowledgeWorkspace initialDocumentKey={params.documentKey} initialFolderKey={params.assetKey} returnTripKey={params.returnTripKey} returnTripName={params.returnTripName} />;
  if (parsed.data === "gallery") return <GalleryWorkspace initialCollectionKey={params.assetKey} returnTripKey={params.returnTripKey} returnTripName={params.returnTripName} />;
  if (parsed.data === "compass") return <TravelWorkspace initialTripKey={params.tripKey} openTripAssets={params.openTripAssets === "1"} />;
  if (parsed.data === "signal") return <EmailWorkspace initialConnectorKey={params.connectorKey} key={params.connectorKey ?? "root"} />;
  return <AscendWorkspace />;
}
