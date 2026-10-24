import { useCallback, useLayoutEffect } from "react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";

import { FilesWorkspace } from "@/components/FilesWorkspace";
import { conversationFileViewSchema } from "@/lib/conversation-retrievals";
import { useAppsStore } from "@/state/apps";

export default function HomeRoute() {
  const router = useRouter();
  const selectAgent = useAppsStore((state) => state.selectAgent);
  const params = useLocalSearchParams<{ folderKey?: string; fileKey?: string; fileTitle?: string; initialQuery?: string; mode?: string; fileView?: string; returnTo?: string }>();
  useLayoutEffect(() => { selectAgent("core"); }, [selectAgent]);
  const exitStorage = useCallback(() => { if (params.returnTo) router.replace(params.returnTo as Href); else router.back(); }, [params.returnTo, router]);
  const mode = params.mode === "image" || params.mode === "speech" || params.mode === "video" ? params.mode : "chat";
  let fileView;
  try { if (params.fileView) fileView = conversationFileViewSchema.parse(JSON.parse(params.fileView)); } catch { /* Ignore invalid or outdated links. */ }
  return <FilesWorkspace initialFileKey={params.fileKey} initialFileTitle={params.fileTitle} initialFolderKey={params.folderKey} initialSearchQuery={params.initialQuery} initialFileView={fileView} onExitFileView={() => router.setParams({ fileView: "" })} onBackFileView={() => router.back()} onExitStorage={params.returnTo ? exitStorage : undefined} generationMode={mode} />;
}
