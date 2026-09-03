import { Redirect, useLocalSearchParams } from "expo-router";

import { AscendWorkspace } from "@/components/capability/AscendWorkspace";
import { GalleryWorkspace } from "@/components/capability/GalleryWorkspace";
import { KnowledgeWorkspace } from "@/components/capability/KnowledgeWorkspace";
import { EmailWorkspace } from "@/components/capability/EmailWorkspace";
import { TravelWorkspace } from "@/components/capability/TravelWorkspace";
import { capabilitySlugSchema } from "@/data/registry";

export default function CapabilityRoute() {
  const params = useLocalSearchParams<{ slug: string; assetKey?: string; bookKey?: string; collectionKind?: string; connectorKey?: string; countryCode?: string; documentKey?: string; draftKey?: string; imageKey?: string; initialQuery?: string; placeKey?: string; toneKey?: string; email_connection_code?: string; email_connection_error?: string; returnTripKey?: string; returnTripName?: string; returnSignalConnectorKey?: string; returnSignalThreadKey?: string; returnSignalMessageKey?: string; signalReturn?: string; signalThreadKey?: string; signalMessageKey?: string; openSignalAttachments?: string; tripKey?: string; openTripAssets?: string }>();
  const parsed = capabilitySlugSchema.safeParse(params.slug);
  if (!parsed.success) {
    return <Redirect href="/capability/archive" />;
  }
  if (parsed.data === "archive") return <KnowledgeWorkspace initialCollectionKind={params.collectionKind} initialDocumentKey={params.documentKey} initialFolderKey={params.assetKey} initialSearchQuery={params.initialQuery} key={`${params.assetKey ?? "root"}:${params.documentKey ?? ""}:${params.collectionKind ?? ""}:${params.initialQuery ?? ""}`} returnSignalConnectorKey={params.returnSignalConnectorKey} returnSignalMessageKey={params.returnSignalMessageKey} returnSignalThreadKey={params.returnSignalThreadKey} returnTripKey={params.returnTripKey} returnTripName={params.returnTripName} />;
  if (parsed.data === "gallery") return <GalleryWorkspace initialCollectionKey={params.assetKey} initialImageKey={params.imageKey} initialSearchQuery={params.initialQuery} key={`${params.assetKey ?? "root"}:${params.imageKey ?? ""}:${params.initialQuery ?? ""}`} returnSignalConnectorKey={params.returnSignalConnectorKey} returnSignalMessageKey={params.returnSignalMessageKey} returnSignalThreadKey={params.returnSignalThreadKey} returnTripKey={params.returnTripKey} returnTripName={params.returnTripName} />;
  if (parsed.data === "compass") return <TravelWorkspace initialCollectionKind={params.collectionKind} initialCountryCode={params.countryCode} initialPlaceKey={params.placeKey} initialSearchQuery={params.initialQuery} initialTripKey={params.tripKey} key={`${params.placeKey ?? ""}:${params.tripKey ?? ""}:${params.countryCode ?? ""}:${params.collectionKind ?? ""}:${params.initialQuery ?? ""}:${params.openTripAssets ?? ""}`} openTripAssets={params.openTripAssets === "1"} />;
  if (parsed.data === "signal") return <EmailWorkspace initialConnectorKey={params.connectorKey} initialDraftKey={params.draftKey} initialMessageKey={params.signalMessageKey} initialThreadKey={params.signalThreadKey} initialToneKey={params.toneKey} navigatedFromRoot={params.signalReturn === "root"} openAttachments={params.openSignalAttachments === "1"} initialCollectionKind={params.collectionKind} initialSearchQuery={params.initialQuery} key={`${params.connectorKey ?? "root"}:${params.signalThreadKey ?? ""}:${params.signalMessageKey ?? ""}:${params.draftKey ?? ""}:${params.toneKey ?? ""}:${params.collectionKind ?? ""}:${params.initialQuery ?? ""}`} />;
  return <AscendWorkspace initialBookKey={params.bookKey} initialSearchQuery={params.initialQuery} key={`${params.bookKey ?? "root"}:${params.initialQuery ?? ""}`} />;
}
