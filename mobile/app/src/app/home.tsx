import { useLocalSearchParams } from "expo-router";

import { FilesWorkspace } from "@/components/FilesWorkspace";

export default function HomeRoute() {
  const params = useLocalSearchParams<{ folderKey?: string; fileKey?: string; fileTitle?: string; initialQuery?: string }>();
  return <FilesWorkspace initialFileKey={params.fileKey} initialFileTitle={params.fileTitle} initialFolderKey={params.folderKey} initialSearchQuery={params.initialQuery} />;
}
