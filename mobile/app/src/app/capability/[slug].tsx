import { Redirect, useLocalSearchParams } from "expo-router";

import { AscendWorkspace } from "@/components/capability/AscendWorkspace";
import { GalleryWorkspace } from "@/components/capability/GalleryWorkspace";
import { KnowledgeWorkspace } from "@/components/capability/KnowledgeWorkspace";
import { EmailWorkspace } from "@/components/capability/EmailWorkspace";
import { TravelWorkspace } from "@/components/capability/TravelWorkspace";
import { capabilitySlugSchema } from "@/data/registry";

export default function CapabilityRoute() {
  const params = useLocalSearchParams<{ slug: string; assetKey?: string; connectorKey?: string; documentKey?: string; imageKey?: string; email_connection_code?: string; email_connection_error?: string; returnTripKey?: string; returnTripName?: string; returnSignalConnectorKey?: string; returnSignalThreadKey?: string; returnSignalMessageKey?: string; signalReturn?: string; signalThreadKey?: string; signalMessageKey?: string; openSignalAttachments?: string; tripKey?: string; openTripAssets?: string }>();
  const parsed = capabilitySlugSchema.safeParse(params.slug);

  if (!parsed.success) {
    return <Redirect href="/capability/archive" />;
  }

  if (parsed.data === "archive") return <KnowledgeWorkspace initialDocumentKey={params.documentKey} initialFolderKey={params.assetKey} returnSignalConnectorKey={params.returnSignalConnectorKey} returnSignalMessageKey={params.returnSignalMessageKey} returnSignalThreadKey={params.returnSignalThreadKey} returnTripKey={params.returnTripKey} returnTripName={params.returnTripName} />;
  if (parsed.data === "gallery") return <GalleryWorkspace initialCollectionKey={params.assetKey} initialImageKey={params.imageKey} returnSignalConnectorKey={params.returnSignalConnectorKey} returnSignalMessageKey={params.returnSignalMessageKey} returnSignalThreadKey={params.returnSignalThreadKey} returnTripKey={params.returnTripKey} returnTripName={params.returnTripName} />;
  if (parsed.data === "compass") return <TravelWorkspace initialTripKey={params.tripKey} openTripAssets={params.openTripAssets === "1"} />;
  if (parsed.data === "signal") return <EmailWorkspace initialConnectorKey={params.connectorKey} initialMessageKey={params.signalMessageKey} initialThreadKey={params.signalThreadKey} navigatedFromRoot={params.signalReturn === "root"} openAttachments={params.openSignalAttachments === "1"} key={`${params.connectorKey ?? "root"}:${params.signalThreadKey ?? ""}:${params.signalMessageKey ?? ""}`} />;
  return <AscendWorkspace />;
}
