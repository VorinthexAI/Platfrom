import { useLocalSearchParams, useRouter } from "expo-router";

import { FilesWorkspace } from "@/components/FilesWorkspace";
import { conversationFileViewSchema } from "@/lib/conversation-retrievals";

export default function HomeRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ folderKey?: string; fileKey?: string; fileTitle?: string; initialQuery?: string; mode?: string; fileView?: string }>();
  const mode = params.mode === "image" || params.mode === "speech" || params.mode === "video" ? params.mode : "chat";
  let fileView;
  try { if (params.fileView) fileView = conversationFileViewSchema.parse(JSON.parse(params.fileView)); } catch { /* Ignore invalid or outdated links. */ }
  return <FilesWorkspace initialFileKey={params.fileKey} initialFileTitle={params.fileTitle} initialFolderKey={params.folderKey} initialSearchQuery={params.initialQuery} initialFileView={fileView} onExitFileView={() => router.setParams({ fileView: "" })} onBackFileView={() => router.back()} generationMode={mode} />;
}
